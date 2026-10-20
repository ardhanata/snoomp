import datetime
import uuid
from typing import Any, Dict, Optional
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Float, ForeignKey, Text
from app.database import Base


class HcpNodeMetric(Base):
    """
    Time-series node performance statistics collected from /mapi/nodes/statistics.
    Tracks CPU, I/O wait, connection saturation, and network bandwidth per node (101-104).
    """
    __tablename__ = "hcp_node_metrics"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    hcp_id = Column(String, ForeignKey("hcp_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    node_number = Column(Integer, nullable=False, index=True)
    frontend_ip = Column(String, nullable=True)
    backend_ip = Column(String, nullable=True)

    cpu_user = Column(Float, default=0.0, nullable=False)
    cpu_system = Column(Float, default=0.0, nullable=False)
    cpu_total = Column(Float, default=0.0, nullable=False)
    io_wait = Column(Float, default=0.0, nullable=False)
    swap_out = Column(Float, default=0.0, nullable=False)

    open_http_connections = Column(Integer, default=0, nullable=False)
    open_https_connections = Column(Integer, default=0, nullable=False)
    max_http_connections = Column(Integer, default=255, nullable=False)
    max_https_connections = Column(Integer, default=255, nullable=False)

    frontend_bytes_read = Column(Float, default=0.0, nullable=False)
    frontend_bytes_written = Column(Float, default=0.0, nullable=False)
    backend_bytes_read = Column(Float, default=0.0, nullable=False)
    backend_bytes_written = Column(Float, default=0.0, nullable=False)

    timestamp = Column(DateTime, default=datetime.datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "hcp_id": self.hcp_id,
            "node_number": self.node_number,
            "frontend_ip": self.frontend_ip,
            "backend_ip": self.backend_ip,
            "cpu_user": round(self.cpu_user, 2),
            "cpu_system": round(self.cpu_system, 2),
            "cpu_total": round(self.cpu_total, 2),
            "io_wait": round(self.io_wait, 2),
            "swap_out": round(self.swap_out, 2),
            "open_http_connections": self.open_http_connections,
            "open_https_connections": self.open_https_connections,
            "total_connections": self.open_http_connections + self.open_https_connections,
            "frontend_bytes_read": round(self.frontend_bytes_read, 2),
            "frontend_bytes_written": round(self.frontend_bytes_written, 2),
            "frontend_mb_per_sec": round((self.frontend_bytes_read + self.frontend_bytes_written) / (1024 * 1024), 2),
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


class HcpSyntheticProbeResult(Base):
    """
    Synthetic probe transaction records (PUT, GET, HEAD, DELETE) per namespace.
    Measures real-time round-trip latency and HTTP status code availability.
    """
    __tablename__ = "hcp_synthetic_probe_results"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    hcp_id = Column(String, ForeignKey("hcp_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_name = Column(String, nullable=False, index=True)
    namespace_name = Column(String, nullable=False, index=True)
    node_number = Column(Integer, nullable=True)

    operation = Column(String, default="HEAD", nullable=False)  # HEAD, GET, PUT, DELETE, ROUNDTRIP
    status_code = Column(Integer, nullable=False)
    latency_ms = Column(Float, default=0.0, nullable=False)
    success = Column(Boolean, default=True, nullable=False)
    error_message = Column(Text, nullable=True)

    timestamp = Column(DateTime, default=datetime.datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "hcp_id": self.hcp_id,
            "tenant_name": self.tenant_name,
            "namespace_name": self.namespace_name,
            "node_number": self.node_number,
            "operation": self.operation,
            "status_code": self.status_code,
            "latency_ms": round(self.latency_ms, 2),
            "success": self.success,
            "error_message": self.error_message,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


class HcpStreamAggregate(Base):
    """
    Aggregated request traffic, status code distribution (2xx, 4xx, 5xx),
    and latency percentiles derived from access logs or probe telemetry.
    """
    __tablename__ = "hcp_stream_aggregates"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    hcp_id = Column(String, ForeignKey("hcp_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_name = Column(String, nullable=False, index=True)
    namespace_name = Column(String, nullable=False, index=True)
    client_ip = Column(String, nullable=True, index=True)
    http_method = Column(String, default="GET", nullable=False)

    status_class = Column(String, nullable=False)  # 2xx, 4xx, 5xx
    status_code = Column(Integer, nullable=False)
    requests_count = Column(Integer, default=0, nullable=False)
    bytes_in = Column(Float, default=0.0, nullable=False)
    bytes_out = Column(Float, default=0.0, nullable=False)

    duration_ms_avg = Column(Float, default=0.0, nullable=False)
    duration_ms_p50 = Column(Float, default=0.0, nullable=False)
    duration_ms_p95 = Column(Float, default=0.0, nullable=False)

    interval_start = Column(DateTime, nullable=False, index=True)
    interval_end = Column(DateTime, nullable=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "hcp_id": self.hcp_id,
            "tenant_name": self.tenant_name,
            "namespace_name": self.namespace_name,
            "client_ip": self.client_ip,
            "http_method": self.http_method,
            "status_class": self.status_class,
            "status_code": self.status_code,
            "requests_count": self.requests_count,
            "bytes_in": self.bytes_in,
            "bytes_out": self.bytes_out,
            "duration_ms_avg": round(self.duration_ms_avg, 2),
            "duration_ms_p50": round(self.duration_ms_p50, 2),
            "duration_ms_p95": round(self.duration_ms_p95, 2),
            "interval_start": self.interval_start.isoformat() if self.interval_start else None,
            "interval_end": self.interval_end.isoformat() if self.interval_end else None,
        }


class HcpLogIngestJob(Base):
    """
    Tracks execution of access-log download and parse cycles.
    """
    __tablename__ = "hcp_log_ingest_jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    hcp_id = Column(String, ForeignKey("hcp_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String, default="pending", nullable=False)  # pending, preparing, downloading, parsing, completed, failed
    records_processed = Column(Integer, default=0, nullable=False)
    error_message = Column(Text, nullable=True)

    started_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "hcp_id": self.hcp_id,
            "status": self.status,
            "records_processed": self.records_processed,
            "error_message": self.error_message,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }
