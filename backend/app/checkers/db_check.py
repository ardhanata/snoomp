import time
import re
import psycopg2
from app.checkers.base import CheckerResult

# F4: Allowlist — only single, read-only SELECT statements
_DANGEROUS_SQL = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|EXECUTE|CALL)\b",
    re.IGNORECASE,
)

def _validate_query(query: str) -> str:
    """Reject anything that isn't a single read-only SELECT."""
    q = query.strip().rstrip(";").strip()
    if not q.upper().startswith("SELECT"):
        raise ValueError(f"Verification query must be a SELECT statement, got: {q[:40]}")
    if ";" in q:
        raise ValueError("Multi-statement queries are not allowed")
    if _DANGEROUS_SQL.search(q):
        raise ValueError("Query contains a disallowed SQL keyword")
    return q

def check_postgres(connection_string: str, query: str = "SELECT 1", timeout: int = 3) -> CheckerResult:
    """Verifies connection to a PostgreSQL database and runs a verification query."""
    start = time.monotonic()
    try:
        query = _validate_query(query)

        # Establish connection with timeout
        # psycopg2 takes connect_timeout in seconds as part of connection string or parameter
        # Let's clean/append connect_timeout to the connection string
        conn_str = connection_string
        if "connect_timeout" not in conn_str:
            separator = " " if " " in conn_str else "&" if "?" in conn_str else "?"
            # Standard DSN string uses spaces, URI uses query params
            if conn_str.startswith("postgresql://") or conn_str.startswith("postgres://"):
                if "?" in conn_str:
                    conn_str += f"&connect_timeout={timeout}"
                else:
                    conn_str += f"?connect_timeout={timeout}"
            else:
                conn_str += f" connect_timeout={timeout}"
                
        with psycopg2.connect(conn_str) as conn:
            with conn.cursor() as cursor:
                # 1. Run validation query
                cursor.execute(query)
                res = cursor.fetchone()
                
                # 2. Get active connections (server-wide)
                try:
                    cursor.execute("SELECT count(*) FROM pg_stat_activity WHERE state IS NOT NULL")
                    conn_count = cursor.fetchone()[0]
                except Exception:
                    conn_count = 0
                    
                # 3. Get TOTAL size of ALL databases on the server (not just connected one)
                try:
                    cursor.execute("""
                        SELECT sum(pg_database_size(datname)) / (1024.0 * 1024.0)
                        FROM pg_database 
                        WHERE datistemplate = false
                    """)
                    val = cursor.fetchone()[0]
                    total_db_size = float(round(val, 2)) if val is not None else 0.0
                except Exception:
                    total_db_size = 0.0

                # 4. Get cache hit ratio (server-wide)
                try:
                    cursor.execute("SELECT (sum(heap_blks_hit) * 100.0) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) FROM pg_statio_user_tables")
                    hit_ratio = cursor.fetchone()[0]
                    hit_ratio = round(float(hit_ratio), 2) if hit_ratio is not None else 100.0
                except Exception:
                    hit_ratio = 100.0
                
                # 5. Count total databases
                try:
                    cursor.execute("SELECT count(*) FROM pg_database WHERE datistemplate = false")
                    db_count = cursor.fetchone()[0]
                except Exception:
                    db_count = 0

                elapsed = (time.monotonic() - start) * 1000
                return CheckerResult(
                    status="up",
                    response_time_ms=round(elapsed, 2),
                    details={
                        "query_result": str(res[0]) if res else "None",
                        "connections_current": conn_count,
                        "mem_resident_mb": total_db_size,
                        "db_count": db_count,
                        "cache_hit_ratio": hit_ratio,
                        # Map metrics to standard percents for history saving
                        "cpu_percent": 0.0,
                        "mem_percent": float(conn_count),
                        "disk_percent": float(hit_ratio)
                    }
                )
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(
            status="down",
            response_time_ms=round(elapsed, 2),
            error=f"Database Connection Failed: {str(e)}"
        )
