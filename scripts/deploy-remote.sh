#!/usr/bin/env bash
# ==============================================================================
# Snoomp — Remote Server Deployment Helper
# ==============================================================================
# Deploys Snoomp from your workstation to a remote Linux server via SSH.
#
# Usage:
#   ./scripts/deploy-remote.sh user@host [/target/path] [--install]
#
# Examples:
#   ./scripts/deploy-remote.sh root@192.168.1.100 /opt/snoomp --install
#   ./scripts/deploy-remote.sh ubuntu@snoomp.mycorp.internal
# ==============================================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ $# -lt 1 ]; then
  echo -e "${BOLD}Snoomp Remote Deployment${NC}"
  echo "Usage: $0 <user@hostname-or-ip> [remote_directory] [--install] [--unattended]"
  echo ""
  echo "Arguments:"
  echo "  user@host          SSH target connection string"
  echo "  remote_directory   Destination directory on remote host (default: /opt/snoomp)"
  echo "  --install          Automatically run ./install.sh on remote host after transfer"
  echo "  --unattended       Run remote installer non-interactively"
  exit 1
fi

SSH_TARGET="$1"
shift

REMOTE_DIR="/opt/snoomp"
DO_INSTALL=false
UNATTENDED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      DO_INSTALL=true
      shift
      ;;
    --unattended)
      UNATTENDED=true
      shift
      ;;
    *)
      if [[ ! "$1" =~ ^-- ]]; then
        REMOTE_DIR="$1"
      fi
      shift
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

echo -e "${BOLD}${CYAN}Preparing Remote Deployment to ${SSH_TARGET}...${NC}"

# 1. Test SSH connection
echo "  • Verifying SSH connection to ${SSH_TARGET}..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "${SSH_TARGET}" "echo -n ''" 2>/dev/null; then
  # Try without batchmode in case password prompt or key passphrase is required
  if ! ssh -o ConnectTimeout=8 "${SSH_TARGET}" "true"; then
    echo -e "${RED}[ERROR] Cannot connect to ${SSH_TARGET} via SSH.${NC}"
    exit 1
  fi
fi
echo -e "  ${GREEN}[OK]${NC} SSH connection established."

# 2. Package release bundle
TMP_PKG="$(mktemp -t snoomp-deploy-XXXXXX.tar.gz)"
cleanup() {
  rm -f "$TMP_PKG"
}
trap cleanup EXIT

echo "  • Building release package..."
"${SCRIPT_DIR}/package.sh" "$TMP_PKG" >/dev/null
echo -e "  ${GREEN}[OK]${NC} Deployment bundle packaged ($(du -h "$TMP_PKG" | cut -f1))."

# 3. Create remote directory and transfer
echo "  • Preparing remote directory ${REMOTE_DIR}..."
ssh "${SSH_TARGET}" "mkdir -p ${REMOTE_DIR} 2>/dev/null || sudo mkdir -p ${REMOTE_DIR} && sudo chown \$(id -u):\$(id -g) ${REMOTE_DIR}"

echo "  • Uploading package to ${SSH_TARGET}:/tmp/snoomp-deploy.tar.gz..."
scp "$TMP_PKG" "${SSH_TARGET}:/tmp/snoomp-deploy.tar.gz"

echo "  • Extracting files into ${REMOTE_DIR}..."
ssh "${SSH_TARGET}" "tar -xzf /tmp/snoomp-deploy.tar.gz -C ${REMOTE_DIR} --strip-components=1 && rm -f /tmp/snoomp-deploy.tar.gz && chmod +x ${REMOTE_DIR}/install.sh ${REMOTE_DIR}/scripts/*.sh"

echo -e "  ${GREEN}[OK]${NC} Snoomp files synchronized to ${REMOTE_DIR}."

# 4. Optional or requested remote install
if [ "$DO_INSTALL" = false ] && [ "$UNATTENDED" = false ]; then
  read -r -p "Run installer on remote host now? [Y/n]: " RUN_INSTALL_RESP
  if [[ ! "$RUN_INSTALL_RESP" =~ ^[Nn]$ ]]; then
    DO_INSTALL=true
  fi
fi

if [ "$DO_INSTALL" = true ]; then
  echo ""
  echo -e "${BOLD}${CYAN}Launching installer on ${SSH_TARGET}...${NC}"
  INSTALL_FLAGS=""
  [ "$UNATTENDED" = true ] && INSTALL_FLAGS="--unattended"
  
  ssh -t "${SSH_TARGET}" "cd ${REMOTE_DIR} && ./install.sh ${INSTALL_FLAGS}"
else
  echo ""
  echo -e "${BOLD}${GREEN}======================================================================${NC}"
  echo -e "${BOLD}  Deployment files copied successfully! 🚀${NC}"
  echo -e "${BOLD}${GREEN}======================================================================${NC}"
  echo ""
  echo -e "To complete installation on the remote server:"
  echo -e "  1. Connect:  ${CYAN}ssh ${SSH_TARGET}${NC}"
  echo -e "  2. Run:      ${CYAN}cd ${REMOTE_DIR} && ./install.sh${NC}"
  echo ""
fi
