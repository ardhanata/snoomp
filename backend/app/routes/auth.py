import os
import secrets
import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional
import time as _time
from collections import defaultdict
import logging

from app.database import get_db
from app.models.user import User
from app.auth.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    require_admin
)
from app.services.email_service import send_password_reset_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

# ponytail: rate limit failed attempts only, resolve real client IP behind proxy, clear on success
_LOGIN_WINDOW = 5 * 60  # 5 minutes
_LOGIN_MAX = 5
_login_attempts: dict[str, list[float]] = defaultdict(list)

# ponytail: rate limit reset requests per IP to prevent email spam (max 5 per 15 minutes)
_FORGOT_WINDOW = 15 * 60
_FORGOT_MAX = 5
_forgot_attempts: dict[str, list[float]] = defaultdict(list)

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"

def _check_rate_limit(ip: str):
    now = _time.monotonic()
    attempts = _login_attempts[ip]
    _login_attempts[ip] = [t for t in attempts if now - t < _LOGIN_WINDOW]
    if len(_login_attempts[ip]) >= _LOGIN_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts, please try again later",
        )

def _record_failed_attempt(ip: str):
    now = _time.monotonic()
    _login_attempts[ip].append(now)

def _clear_rate_limit(ip: str):
    _login_attempts.pop(ip, None)

def _check_forgot_rate_limit(ip: str):
    now = _time.monotonic()
    attempts = _forgot_attempts[ip]
    _forgot_attempts[ip] = [t for t in attempts if now - t < _FORGOT_WINDOW]
    if len(_forgot_attempts[ip]) >= _FORGOT_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Terlalu banyak permintaan reset password. Silakan coba lagi nanti.",
        )
    _forgot_attempts[ip].append(now)

class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: Optional[str] = Field(None, max_length=255)
    password: str = Field(..., min_length=6)
    role: str = Field("viewer", pattern="^(admin|editor|viewer)$")

class UserUpdate(BaseModel):
    email: Optional[str] = Field(None, max_length=255)
    password: Optional[str] = Field(None, min_length=6)

class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    role: str
    is_active: bool

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str

class ForgotPasswordRequest(BaseModel):
    identifier: str = Field(..., min_length=1, max_length=255)

class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=10)
    new_password: str = Field(..., min_length=6)

@router.post("/login", response_model=Token)
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    client_ip = _get_client_ip(request)
    _check_rate_limit(client_ip)

    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        _record_failed_attempt(client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
        
    # Clear failed attempt history upon successful authentication
    _clear_rate_limit(client_ip)

    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer", "role": user.role}

@router.post("/register", response_model=UserResponse, dependencies=[Depends(require_admin)])
def register_user(user_in: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == user_in.username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
        
    clean_email = user_in.email.strip().lower() if user_in.email else None
    if clean_email:
        existing_email = db.query(User).filter(User.email == clean_email).first()
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered to another account"
            )

    hashed_password = get_password_hash(user_in.password)
    user = User(
        username=user_in.username,
        email=clean_email,
        hashed_password=hashed_password,
        role=user_in.role
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user

@router.put("/me", response_model=UserResponse)
def update_current_user(user_in: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user_in.email is not None:
        clean_email = user_in.email.strip().lower() or None
        if clean_email:
            existing = db.query(User).filter(User.email == clean_email, User.id != current_user.id).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already in use by another account"
                )
        current_user.email = clean_email

    if user_in.password:
        current_user.hashed_password = get_password_hash(user_in.password)

    db.commit()
    db.refresh(current_user)
    return current_user

@router.post("/forgot-password")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    client_ip = _get_client_ip(request)
    _check_forgot_rate_limit(client_ip)

    identifier = body.identifier.strip()
    user = db.query(User).filter(
        (User.username == identifier) | (User.email == identifier.lower())
    ).first()

    # ponytail: constant generic message to prevent account and email enumeration attacks
    generic_msg = (
        "Jika akun dengan informasi tersebut terdaftar dan memiliki email valid, "
        "tautan reset password telah dikirim ke email Anda."
    )

    if not user or not user.is_active or not user.email:
        return {"message": generic_msg}

    # Generate secure 32-byte reset token valid for 1 hour
    token = secrets.token_urlsafe(32)
    user.reset_token = token
    user.reset_token_expires = datetime.datetime.utcnow() + datetime.timedelta(hours=1)
    db.commit()

    # Resolve application origin URL
    app_url = os.environ.get("APP_URL", "").strip().rstrip("/")
    if not app_url:
        origin = request.headers.get("origin")
        if origin:
            app_url = origin.rstrip("/")
        else:
            host = request.headers.get("host") or "localhost:8008"
            scheme = request.url.scheme or "http"
            app_url = f"{scheme}://{host}"

    reset_url = f"{app_url}/reset-password?token={token}"
    email_sent = send_password_reset_email(user.email, reset_url)
    if not email_sent:
        logger.info("[DEV RESET LINK] User '%s' reset URL: %s", user.username, reset_url)

    return {"message": generic_msg}

@router.get("/verify-reset-token")
def verify_reset_token(token: str, db: Session = Depends(get_db)):
    clean_token = token.strip()
    if not clean_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token tidak valid")

    user = db.query(User).filter(User.reset_token == clean_token).first()
    if not user or not user.reset_token_expires or user.reset_token_expires < datetime.datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tautan reset tidak valid atau sudah kedaluwarsa"
        )
    return {"valid": True, "username": user.username}

@router.post("/reset-password")
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    client_ip = _get_client_ip(request)
    _check_rate_limit(client_ip)

    clean_token = body.token.strip()
    user = db.query(User).filter(User.reset_token == clean_token).first()
    if not user or not user.reset_token_expires or user.reset_token_expires < datetime.datetime.utcnow():
        _record_failed_attempt(client_ip)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tautan reset tidak valid atau sudah kedaluwarsa"
        )

    user.hashed_password = get_password_hash(body.new_password)
    user.reset_token = None
    user.reset_token_expires = None
    db.commit()

    _clear_rate_limit(client_ip)
    return {"message": "Password berhasil diperbarui. Silakan masuk menggunakan password baru."}

@router.get("/users", response_model=List[UserResponse], dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).all()

@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    db.delete(user)
    db.commit()
