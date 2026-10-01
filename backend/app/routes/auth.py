from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List
import time as _time
from collections import defaultdict

from app.database import get_db
from app.models.user import User
from app.auth.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    require_admin
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

# ponytail: rate limit failed attempts only, resolve real client IP behind proxy, clear on success
_LOGIN_WINDOW = 5 * 60  # 5 minutes
_LOGIN_MAX = 5
_login_attempts: dict[str, list[float]] = defaultdict(list)

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

class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)
    role: str = Field("viewer", pattern="^(admin|editor|viewer)$")

class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str

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
        
    hashed_password = get_password_hash(user_in.password)
    user = User(
        username=user_in.username,
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
