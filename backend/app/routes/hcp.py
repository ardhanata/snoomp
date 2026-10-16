import datetime
import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.security import require_viewer, require_editor
from app.models.hcp import HcpTenant
from app.services.hcp_service import query_hcp_tenant_mapi, query_hcp_cluster_mapi, list_hcp_tenants
from app.websockets import publish_update

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hcp", tags=["HCP Object Storage"])


class HcpTenantCreateUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    host: str = Field(..., min_length=1)
    port: int = Field(9090, ge=1, le=65535)
    tenant_name: str = Field("*", max_length=100)
    is_cluster: bool = False
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(...)
    ignore_tls: bool = False
    site: Optional[str] = None
    enabled: bool = True
    check_interval: int = Field(300, ge=30, le=86400)


class HcpTestPayload(BaseModel):
    host: str = Field(..., min_length=1)
    port: int = Field(9090, ge=1, le=65535)
    tenant_name: str = Field("*", max_length=100)
    is_cluster: bool = False
    username: str = Field(..., min_length=1)
    password: str = Field(...)
    ignore_tls: bool = False
    existing_tenant_id: Optional[str] = None


@router.get("/tenants", dependencies=[Depends(require_viewer)])
def list_hcp_tenants_endpoint(db: Session = Depends(get_db)):
    """List all configured HCP tenants with their cached storage and quota metrics."""
    tenants = db.query(HcpTenant).order_by(HcpTenant.created_at.desc()).all()
    return [t.to_dict(include_metrics=True) for t in tenants]


@router.get("/tenants/{tenant_id}", dependencies=[Depends(require_viewer)])
def get_hcp_tenant(tenant_id: str, db: Session = Depends(get_db)):
    """Get single HCP tenant details and full namespace metrics."""
    tenant = db.query(HcpTenant).filter(HcpTenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="HCP tenant not found")
    return tenant.to_dict(include_metrics=True)


@router.post("/tenants", dependencies=[Depends(require_editor)])
async def create_hcp_tenant(payload: HcpTenantCreateUpdate, db: Session = Depends(get_db)):
    """Create a new HCP tenant or cluster endpoint and perform initial discovery sync."""
    effective_tenant = "*" if payload.is_cluster else (payload.tenant_name.strip() or "default")
    tenant = HcpTenant(
        name=payload.name,
        host=payload.host.strip(),
        port=payload.port,
        tenant_name=effective_tenant,
        is_cluster=payload.is_cluster,
        username=payload.username.strip(),
        password=payload.password,
        ignore_tls=payload.ignore_tls,
        site=payload.site.strip().lower() if payload.site else None,
        enabled=payload.enabled,
        check_interval=payload.check_interval,
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    if tenant.enabled:
        try:
            if tenant.is_cluster:
                res = await query_hcp_cluster_mapi(
                    host=tenant.host,
                    port=tenant.port,
                    username=tenant.username,
                    password=tenant.password,
                    ignore_tls=tenant.ignore_tls,
                    timeout_sec=5.0,
                )
            else:
                res = await query_hcp_tenant_mapi(
                    host=tenant.host,
                    port=tenant.port,
                    tenant_name=tenant.tenant_name,
                    username=tenant.username,
                    password=tenant.password,
                    ignore_tls=tenant.ignore_tls,
                    timeout_sec=5.0,
                )
            tenant.last_status = res["status"]
            tenant.last_response_time_ms = res["response_time_ms"]
            tenant.last_sync_at = datetime.datetime.utcnow()
            tenant.metrics_cache = res
            tenant.last_error = None
        except Exception as e:
            tenant.last_status = "down"
            tenant.last_sync_at = datetime.datetime.utcnow()
            tenant.last_error = str(e)
            logger.warning(f"Initial sync for HCP endpoint '{tenant.name}' failed: {e}")

        db.commit()
        db.refresh(tenant)

    publish_update({"type": "hcp_reload"})
    return tenant.to_dict(include_metrics=True)


@router.put("/tenants/{tenant_id}", dependencies=[Depends(require_editor)])
async def update_hcp_tenant(tenant_id: str, payload: HcpTenantCreateUpdate, db: Session = Depends(get_db)):
    """Update HCP tenant configuration and merge credentials if redacted."""
    tenant = db.query(HcpTenant).filter(HcpTenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="HCP tenant not found")

    tenant.name = payload.name
    tenant.host = payload.host.strip()
    tenant.port = payload.port
    tenant.is_cluster = payload.is_cluster
    tenant.tenant_name = "*" if payload.is_cluster else (payload.tenant_name.strip() or "default")
    tenant.username = payload.username.strip()

    REDACT_SENTINEL = "••••••••"
    if payload.password and payload.password != REDACT_SENTINEL:
        tenant.password = payload.password

    tenant.ignore_tls = payload.ignore_tls
    tenant.site = payload.site.strip().lower() if payload.site else None
    tenant.enabled = payload.enabled
    tenant.check_interval = payload.check_interval

    db.commit()
    db.refresh(tenant)

    publish_update({"type": "hcp_reload"})
    return tenant.to_dict(include_metrics=True)


@router.delete("/tenants/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_editor)])
def delete_hcp_tenant(tenant_id: str, db: Session = Depends(get_db)):
    """Delete an HCP tenant configuration."""
    tenant = db.query(HcpTenant).filter(HcpTenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="HCP tenant not found")

    db.delete(tenant)
    db.commit()
    publish_update({"type": "hcp_reload"})
    return


@router.post("/tenants/{tenant_id}/sync", dependencies=[Depends(require_editor)])
async def sync_hcp_tenant(tenant_id: str, db: Session = Depends(get_db)):
    """Forces an immediate live refresh of HCP storage and quota metrics."""
    tenant = db.query(HcpTenant).filter(HcpTenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="HCP tenant not found")

    try:
        if tenant.is_cluster:
            res = await query_hcp_cluster_mapi(
                host=tenant.host,
                port=tenant.port,
                username=tenant.username,
                password=tenant.password,
                ignore_tls=tenant.ignore_tls,
                timeout_sec=5.0,
            )
        else:
            res = await query_hcp_tenant_mapi(
                host=tenant.host,
                port=tenant.port,
                tenant_name=tenant.tenant_name,
                username=tenant.username,
                password=tenant.password,
                ignore_tls=tenant.ignore_tls,
                timeout_sec=5.0,
            )
        tenant.last_status = res["status"]
        tenant.last_response_time_ms = res["response_time_ms"]
        tenant.last_sync_at = datetime.datetime.utcnow()
        tenant.metrics_cache = res
        tenant.last_error = None
    except Exception as e:
        tenant.last_status = "down"
        tenant.last_sync_at = datetime.datetime.utcnow()
        tenant.last_error = str(e)
        logger.warning(f"Manual sync for HCP endpoint '{tenant.name}' failed: {e}")

    db.commit()
    db.refresh(tenant)
    publish_update({"type": "hcp_reload"})

    return tenant.to_dict(include_metrics=True)


@router.post("/test", dependencies=[Depends(require_editor)])
async def test_hcp_connection(payload: HcpTestPayload, db: Session = Depends(get_db)):
    """Executes a live verification probe against HCP MAPI endpoint without modifying DB."""
    pwd = payload.password
    REDACT_SENTINEL = "••••••••"
    if (not pwd or pwd == REDACT_SENTINEL) and payload.existing_tenant_id:
        existing = db.query(HcpTenant).filter(HcpTenant.id == payload.existing_tenant_id).first()
        if existing:
            pwd = existing.password

    try:
        if payload.is_cluster:
            tenants = await list_hcp_tenants(
                host=payload.host.strip(),
                port=payload.port,
                username=payload.username.strip(),
                password=pwd,
                ignore_tls=payload.ignore_tls,
                timeout_sec=5.0,
            )
            sample_names = ", ".join(tenants[:6])
            suffix = "..." if len(tenants) > 6 else ""
            return {
                "status": "ok",
                "message": f"Cluster connection verified. Discovered {len(tenants)} active tenant(s): {sample_names}{suffix}.",
                "discovered_tenants": tenants,
            }

        effective_tenant = payload.tenant_name.strip() or "default"
        res = await query_hcp_tenant_mapi(
            host=payload.host.strip(),
            port=payload.port,
            tenant_name=effective_tenant,
            username=payload.username.strip(),
            password=pwd,
            ignore_tls=payload.ignore_tls,
            timeout_sec=5.0,
        )
        ns_count = len(res.get("namespaces", []))
        used_fmt = res.get("tenant", {}).get("storage_used_formatted", "0 B")
        quota_fmt = res.get("tenant", {}).get("hard_quota_formatted", "Unlimited")
        ms = res.get("response_time_ms", 0)

        return {
            "status": "ok",
            "message": f"Connection verified in {ms}ms. Tenant '{effective_tenant}' reached: {ns_count} namespaces found, {used_fmt} used of {quota_fmt}.",
            "details": res,
        }
    except PermissionError as pe:
        return {
            "status": "down",
            "error": str(pe),
            "response_time_ms": 0.0,
        }
    except LookupError as le:
        return {
            "status": "down",
            "error": str(le),
            "response_time_ms": 0.0,
        }
    except Exception as e:
        return {
            "status": "down",
            "error": f"Failed to connect to HCP Management API on https://{payload.host}:{payload.port}: {str(e)}",
            "response_time_ms": 0.0,
        }
