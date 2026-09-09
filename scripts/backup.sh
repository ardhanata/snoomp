#!/usr/bin/env bash
# ==============================================================================
# Snoomp — Database & Instance Migration Backup Script
# ==============================================================================
# Creates a full migration archive containing:
#   1. Complete PostgreSQL / TimescaleDB custom dump (including all hypertables)
#   2. Environment variables (.env)
#   3. Version stamp and migration manifest
#
# Usage:
#   ./scripts/backup.sh [output_directory]
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

OUTPUT_DIR="${1:-${ROOT_DIR}/backups}"
mkdir -p "$OUTPUT_DIR"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
ARCHIVE_NAME="snoomp-migration-${TIMESTAMP}.tar.gz"
TMP_DIR="$(mktemp -d -t snoomp-backup-XXXXXX)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo -e "${BOLD}${CYAN}Starting Snoomp Instance Backup...${NC}"

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

# Ensure database container is running
if ! $DOCKER_COMPOSE_CMD ps --services --filter "status=running" | grep -q "^db$"; then
  echo -e "${RED}[ERROR] Database container (snoomp-db) is not running.${NC}"
  echo "  Start it with: ${DOCKER_COMPOSE_CMD} up -d db"
  exit 1
fi

# 1. Read db credentials from .env
PG_USER="$(grep "^POSTGRES_USER=" .env 2>/dev/null | cut -d'=' -f2- | tr -d '\r"' || echo "snoomp_admin")"
PG_DB="$(grep "^POSTGRES_DB=" .env 2>/dev/null | cut -d'=' -f2- | tr -d '\r"' || echo "snoomp_db")"

echo -e "  • Dumping database '${PG_DB}' (TimescaleDB / PostgreSQL)..."
$DOCKER_COMPOSE_CMD exec -T db pg_dump -U "${PG_USER}" -d "${PG_DB}" -Fc > "${TMP_DIR}/database.dump"

DUMP_SIZE="$(du -h "${TMP_DIR}/database.dump" | cut -f1)"
echo -e "  ${GREEN}[OK]${NC} Database dumped successfully (${DUMP_SIZE})."

# 2. Copy .env
if [ -f .env ]; then
  cp .env "${TMP_DIR}/snoomp.env"
  echo -e "  ${GREEN}[OK]${NC} Environment configuration copied."
fi

# 3. Create Manifest
VERSION="$(cat VERSION 2>/dev/null || echo '1.2.0')"
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

cat <<EOF > "${TMP_DIR}/manifest.json"
{
  "backup_type": "full_migration",
  "version": "${VERSION}",
  "git_commit": "${GIT_COMMIT}",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "database_name": "${PG_DB}",
  "database_user": "${PG_USER}"
}
EOF

# 4. Create compressed tarball
ARCHIVE_PATH="${OUTPUT_DIR}/${ARCHIVE_NAME}"
tar -czf "${ARCHIVE_PATH}" -C "${TMP_DIR}" .

TOTAL_SIZE="$(du -h "${ARCHIVE_PATH}" | cut -f1)"
echo ""
echo -e "${BOLD}${GREEN}======================================================================${NC}"
echo -e "${BOLD}  Backup Complete! 📦${NC}"
echo -e "${BOLD}${GREEN}======================================================================${NC}"
echo -e "  Archive file:  ${BOLD}${CYAN}${ARCHIVE_PATH}${NC} (${TOTAL_SIZE})"
echo ""
echo -e "${BOLD}To migrate to another server:${NC}"
echo "  1. Copy archive: scp ${ARCHIVE_PATH} user@new-server:/opt/snoomp/"
echo "  2. On new server: ./scripts/restore.sh ${ARCHIVE_NAME}"
echo ""
