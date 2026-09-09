#!/usr/bin/env bash
# ==============================================================================
# Snoomp — Self-Contained Deployment Release Packager
# ==============================================================================
# Packages the entire repository into a clean distribution archive
# (snoomp-deploy.tar.gz) suitable for uploading to an offline or remote server.
#
# Usage:
#   ./scripts/package.sh [output_path]
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

OUTPUT_FILE="${1:-${ROOT_DIR}/dist/snoomp-deploy.tar.gz}"
mkdir -p "$(dirname "$OUTPUT_FILE")"

VERSION="$(cat VERSION 2>/dev/null || echo '1.2.0')"

echo -e "${BOLD}${CYAN}Packaging Snoomp Deployment Bundle v${VERSION}...${NC}"

# Define temporary build directory
TMP_DIR="$(mktemp -d -t snoomp-pkg-XXXXXX)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

PKG_DIR="${TMP_DIR}/snoomp"
mkdir -p "$PKG_DIR"

# Copy project structure while excluding heavy dependencies and caches
echo "  • Copying core project files..."
tar -cf - \
  --exclude="node_modules" \
  --exclude=".venv" \
  --exclude="venv" \
  --exclude="__pycache__" \
  --exclude="dist" \
  --exclude="*/dist" \
  --exclude="build" \
  --exclude="*/build" \
  --exclude="*/build/*" \
  --exclude="*.exe" \
  --exclude="*.pkg" \
  --exclude="*.pyz" \
  --exclude="*.mp4" \
  --exclude=".git" \
  --exclude=".github" \
  --exclude=".agents" \
  --exclude=".codegraph" \
  --exclude=".superpowers" \
  --exclude=".vscode" \
  --exclude="graphify-out" \
  --exclude=".pytest_cache" \
  --exclude="*.dump" \
  --exclude="*.tar.gz" \
  --exclude=".env" \
  --exclude=".env.*" \
  --exclude="*.sqlite*" \
  --exclude="*.db" \
  --exclude="*.py[cod]" \
  docker-compose.yml .env.example VERSION README.md install.sh backend frontend scripts deploy docs 2>/dev/null | (cd "$PKG_DIR" && tar -xf -)

# Copy optional metadata files if present
for f in LICENSE CONTEXT.md CHANGELOG.md; do
  [ -f "$f" ] && cp -a "$f" "$PKG_DIR/" || true
done

chmod +x "$PKG_DIR/install.sh"
chmod +x "$PKG_DIR/scripts/"*.sh 2>/dev/null || true

# Create tarball
echo "  • Compressing release archive..."
tar -czf "$OUTPUT_FILE" -C "$TMP_DIR" snoomp

ARCHIVE_SIZE="$(du -h "$OUTPUT_FILE" | cut -f1)"

echo ""
echo -e "${BOLD}${GREEN}======================================================================${NC}"
echo -e "${BOLD}  Package Created Successfully! 📦${NC}"
echo -e "${BOLD}${GREEN}======================================================================${NC}"
echo -e "  File: ${BOLD}${CYAN}${OUTPUT_FILE}${NC} (${ARCHIVE_SIZE})"
echo ""
echo -e "${BOLD}To deploy to a target server:${NC}"
echo "  1. scp ${OUTPUT_FILE} user@remote-server:/tmp/"
echo "  2. ssh user@remote-server"
echo "     mkdir -p /opt/snoomp && tar -xzf /tmp/snoomp-deploy.tar.gz -C /opt"
echo "     cd /opt/snoomp && ./install.sh"
echo ""
