"""
Snoomp Standalone Server Entrypoint for Windows Executable and Service.
"""
import os
import sys
import argparse
import logging
import secrets

# If running as a frozen PyInstaller bundle, fix sys.path and working directory
if getattr(sys, "frozen", False):
    bundle_dir = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    sys.path.insert(0, bundle_dir)
    # Ensure current working directory is writable (beside exe)
    exe_dir = os.path.dirname(sys.executable)
    if exe_dir and os.path.isdir(exe_dir):
        os.chdir(exe_dir)
else:
    # Development mode: ensure backend dir is on path
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, backend_dir)

# Load optional .env / snoomp.env file beside executable
env_file = os.path.join(os.getcwd(), "snoomp.env")
if not os.path.exists(env_file):
    env_file = os.path.join(os.getcwd(), ".env")

if os.path.exists(env_file):
    try:
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip().strip("'\"")
                    if k not in os.environ:
                        os.environ[k] = v
    except Exception as e:
        print(f"[WARN] Failed reading {env_file}: {e}")

# Ensure default environment variables for standalone execution
if "DATABASE_URL" not in os.environ:
    db_path = os.path.abspath(os.path.join(os.getcwd(), "snoomp.db"))
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

if "JWT_SECRET" not in os.environ:
    # Auto-generate a secure random secret if not set
    os.environ["JWT_SECRET"] = secrets.token_urlsafe(48)

if "ALLOWED_ORIGINS" not in os.environ:
    os.environ["ALLOWED_ORIGINS"] = "*"

from logging.handlers import RotatingFileHandler

# Set up logging directory beside executable
log_dir = os.path.join(os.getcwd(), "logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, "snoomp.log")

file_handler = RotatingFileHandler(log_file, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8")
file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))

stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.handlers = [file_handler, stream_handler]

logger = logging.getLogger("snoomp_server")

def main():
    parser = argparse.ArgumentParser(description="Snoomp Infrastructure Monitoring Server")
    parser.add_argument("--port", "-p", type=int, default=int(os.environ.get("PORT", "8008")), help="HTTP server port (default: 8008)")
    parser.add_argument("--host", "-H", type=str, default=os.environ.get("HOST", "0.0.0.0"), help="Host to bind (default: 0.0.0.0)")
    parser.add_argument("--version", "-v", action="store_true", help="Show Snoomp version and exit")
    parser.add_argument("--test-db", action="store_true", help="Test database connection and verify schema, then exit")
    parser.add_argument("--test-redis", action="store_true", help="Test Redis connection, then exit")
    
    args = parser.parse_args()

    if args.version:
        from app.main import get_app_version
        print(f"Snoomp v{get_app_version()} (Enterprise Infrastructure Observability)")
        sys.exit(0)

    if args.test_db:
        try:
            from app.database import init_db, engine
            db_disp = engine.url.render_as_string(hide_password=True)
            logger.info("Verifying database connectivity to [%s]...", db_disp)
            init_db()
            logger.info("[SUCCESS] Database schema initialized and connection verified successfully.")
            sys.exit(0)
        except Exception as e:
            logger.error("[FAILED] Database connection/schema verification failed: %s", e)
            sys.exit(1)

    if args.test_redis:
        redis_url = os.environ.get("REDIS_URL")
        if not redis_url:
            logger.info("REDIS_URL not set. Running in standalone in-process broker mode.")
            sys.exit(0)
        try:
            import redis
            logger.info("Verifying Redis connectivity at [%s]...", redis_url)
            r = redis.from_url(redis_url, socket_timeout=3)
            r.ping()
            logger.info("[SUCCESS] Redis connection verified successfully.")
            sys.exit(0)
        except Exception as e:
            logger.error("[FAILED] Redis connection failed: %s", e)
            sys.exit(1)

    import uvicorn
    from app.main import app

    logger.info("=" * 60)
    logger.info("  SNOOMP ENTERPRISE MONITORING PLATFORM")
    logger.info("  Mode: Standalone Windows Server")
    logger.info("  Database: %s", os.environ.get("DATABASE_URL", "sqlite:///snoomp.db").split("@")[-1])
    logger.info("  Log file: %s", log_file)
    logger.info("  Listening on: http://%s:%d", "127.0.0.1" if args.host == "0.0.0.0" else args.host, args.port)
    logger.info("=" * 60)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
        access_log=False,
    )

if __name__ == "__main__":
    main()
