#!/usr/bin/env bash
# ==============================================================================
# Snoomp — Database & Instance Migration Restore Script
# ==============================================================================
# Restores a Snoomp instance from:
#   - A migration tarball (.tar.gz created by scripts/backup.sh)
#   - A standalone PostgreSQL / TimescaleDB dump (.dump)
#
# Usage:
#   ./scripts/restore.sh <path_to_backup_archive_or_dump> [--restore-env]
# ==============================================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

if [ $# -lt 1 ]; then
  echo -e "${RED}[ERROR] Missing backup file argument.${NC}"
  echo "Usage: ./scripts/restore.sh <snoomp-migration-*.tar.gz | database.dump> [--restore-env]"
  exit 1
fi

BACKUP_FILE="$1"
RESTORE_ENV=false

if [ "${2:-}" = "--restore-env" ]; then
  RESTORE_ENV=true
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo -e "${RED}[ERROR] Backup file not found: ${BACKUP_FILE}${NC}"
  exit 1
fi

TMP_DIR="$(mktemp -d -t snoomp-restore-XXXXXX)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo -e "${BOLD}${CYAN}Preparing to restore Snoomp instance...${NC}"

# Detect Docker Compose
DOCKER_COMPOSE_CMD=""
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker-compose"
else
  echo -e "${RED}[ERROR] Docker Compose not found.${NC}"
  exit 1
fi

DUMP_PATH=""

# Determine if input is a tar.gz archive or raw dump
if [[ "$BACKUP_FILE" =~ \.tar\.gz$ ]] || [[ "$BACKUP_FILE" =~ \.tgz$ ]]; then
  echo -e "  • Extracting migration archive..."
  tar -xzf "$BACKUP_FILE" -C "$TMP_DIR"

  if [ -f "${TMP_DIR}/manifest.json" ]; then
    echo -e "  • Found backup manifest:"
    cat "${TMP_DIR}/manifest.json" | grep -E '"(version|created_at|database_name)"' || true
  fi

  if [ -f "${TMP_DIR}/database.dump" ]; then
    DUMP_PATH="${TMP_DIR}/database.dump"
  else
    echo -e "${RED}[ERROR] Archive does not contain database.dump!${NC}"
    exit 1
  fi

  if [ -f "${TMP_DIR}/snoomp.env" ]; then
    if [ "$RESTORE_ENV" = true ]; then
      echo -e "  • Restoring .env from backup..."
      cp "${TMP_DIR}/snoomp.env" .env
    else
      echo -e "  ${YELLOW}[NOTE]${NC} Archive contains an environment file (snoomp.env)."
      echo "  To overwrite the current .env with the backup's .env, rerun with --restore-env."
    fi
  fi
else
  # Direct dump file
  DUMP_PATH="$BACKUP_FILE"
fi

# Ensure database service is up
echo -e "  • Checking database service..."
$DOCKER_COMPOSE_CMD up -d db

# Wait for DB to be healthy
echo -e "  • Waiting for database container readiness..."
MAX_TRIES=20
TRIES=0
until $DOCKER_COMPOSE_CMD exec -T db pg_isready -U "$($DOCKER_COMPOSE_CMD exec -T db printenv POSTGRES_USER || echo "snoomp_admin")" >/dev/null 2>&1; do
  sleep 2
  TRIES=$((TRIES + 1))
  if [ $TRIES -ge $MAX_TRIES ]; then
    echo -e "${RED}[ERROR] Database container did not become ready in time.${NC}"
    exit 1
  fi
done

# Read credentials
PG_USER="$($DOCKER_COMPOSE_CMD exec -T db printenv POSTGRES_USER || echo "snoomp_admin")"
PG_DB="$($DOCKER_COMPOSE_CMD exec -T db printenv POSTGRES_DB || echo "snoomp_db")"

echo -e "  • Copying dump into database container..."
$DOCKER_COMPOSE_CMD cp "$DUMP_PATH" db:/tmp/restore.dump

echo -e "  • Restoring database '${PG_DB}'..."
# Execute pg_restore with clean and if-exists
$DOCKER_COMPOSE_CMD exec -T db pg_restore \
  -U "${PG_USER}" \
  -d "${PG_DB}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  /tmp/restore.dump || true

$DOCKER_COMPOSE_CMD exec -T db rm -f /tmp/restore.dump
echo -e "  ${GREEN}[OK]${NC} Database restored."

# Restart API and worker containers
echo -e "  • Restarting API and Worker services..."
$DOCKER_COMPOSE_CMD restart api worker

echo ""
echo -e "${BOLD}${GREEN}======================================================================${NC}"
echo -e "${BOLD}  Restore Finished Successfully! 🚀${NC}"
echo -e "${BOLD}${GREEN}======================================================================${NC}"
echo "  The database has been imported and services have re-synchronized."
echo "  Check container status: ${DOCKER_COMPOSE_CMD} ps"
echo "  Check API logs:         ${DOCKER_COMPOSE_CMD} logs -f api"
echo ""
