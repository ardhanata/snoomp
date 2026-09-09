#!/usr/bin/env bash
# ==============================================================================
# Snoomp — Production Turnkey Installer & Setup Script
# ==============================================================================
# Automates deployment on any Linux host (Ubuntu, Debian, RHEL, Rocky, etc.)
# Usage:
#   Interactive:   ./install.sh
#   Unattended:    ./install.sh --unattended --port 8008 --domain monitor.example.com
#   With Systemd:  ./install.sh --install-service
# ==============================================================================

set -euo pipefail

# Text styling
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# Defaults
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

UNATTENDED=false
INSTALL_SERVICE=false
ARG_PORT=""
ARG_BIND_IP=""
ARG_DOMAIN=""
ARG_ADMIN_PASS=""
ARG_DIR=""
ARG_REPO="https://github.com/ardhanata/snoomp.git"
ARG_BRANCH="main"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --unattended|-y)
      UNATTENDED=true
      shift
      ;;
    --install-service)
      INSTALL_SERVICE=true
      shift
      ;;
    --port)
      ARG_PORT="$2"
      shift 2
      ;;
    --bind-ip)
      ARG_BIND_IP="$2"
      shift 2
      ;;
    --domain)
      ARG_DOMAIN="$2"
      shift 2
      ;;
    --admin-password)
      ARG_ADMIN_PASS="$2"
      shift 2
      ;;
    --dir)
      ARG_DIR="$2"
      shift 2
      ;;
    --repo)
      ARG_REPO="$2"
      shift 2
      ;;
    --branch)
      ARG_BRANCH="$2"
      shift 2
      ;;
    --help|-h)
      cat <<EOF
Snoomp Installer & Setup

Usage:
  Direct clone:
    git clone https://github.com/ardhanata/snoomp.git /opt/snoomp
    cd /opt/snoomp && sudo ./install.sh

  One-liner GitHub bootstrap:
    curl -fsSL https://raw.githubusercontent.com/ardhanata/snoomp/main/install.sh | sudo bash
    curl -fsSL https://raw.githubusercontent.com/ardhanata/snoomp/main/install.sh | sudo bash -s -- --unattended --domain monitor.example.com

Options:
  --unattended, -y      Run non-interactively using defaults or provided flags
  --dir <path>          Installation directory when bootstrapping (default: /opt/snoomp or ~/snoomp)
  --repo <url>          Git repo URL when bootstrapping (default: https://github.com/ardhanata/snoomp.git)
  --branch <branch>     Git branch when bootstrapping (default: main)
  --port <port>         Host port for Snoomp (default: 8008)
  --bind-ip <ip>        Host IP to bind to (0.0.0.0 for external, 127.0.0.1 for proxy)
  --domain <domain>     Public domain or IP to append to ALLOWED_ORIGINS
  --admin-password <pw> Pre-seed admin user password (random if not specified)
  --install-service     Install and enable systemd service (requires root/sudo)
  --help, -h            Show this help message
EOF
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Check if running outside a Snoomp repository (e.g. via curl | bash)
if [ ! -f "${SCRIPT_DIR}/docker-compose.yml" ] && [ ! -f "docker-compose.yml" ]; then
  log_info "Snoomp project files not found in current directory."
  log_info "Bootstrapping repository from GitHub (${ARG_REPO})..."

  TARGET_DIR="$ARG_DIR"
  if [ -z "$TARGET_DIR" ]; then
    if [ "$(id -u)" -eq 0 ] || [ -w "/opt" 2>/dev/null ]; then
      TARGET_DIR="/opt/snoomp"
    else
      TARGET_DIR="${HOME}/snoomp"
    fi
  fi

  # Ensure git is available, attempt install if missing
  if ! command -v git >/dev/null 2>&1; then
    log_info "git not found. Attempting to install git..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update -y && sudo apt-get install -y git || true
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y git || true
    elif command -v yum >/dev/null 2>&1; then
      sudo yum install -y git || true
    elif command -v pacman >/dev/null 2>&1; then
      sudo pacman -Sy --noconfirm git || true
    elif command -v apk >/dev/null 2>&1; then
      sudo apk add git || true
    fi
  fi

  if command -v git >/dev/null 2>&1; then
    if [ -d "${TARGET_DIR}/.git" ]; then
      log_info "Existing repository detected in ${TARGET_DIR}. Pulling latest changes..."
      cd "$TARGET_DIR"
      git fetch --all --prune
      git checkout "$ARG_BRANCH"
      git pull origin "$ARG_BRANCH"
    else
      log_info "Cloning ${ARG_REPO} (${ARG_BRANCH}) into ${TARGET_DIR}..."
      mkdir -p "$(dirname "$TARGET_DIR")"
      git clone --branch "$ARG_BRANCH" "$ARG_REPO" "$TARGET_DIR"
      cd "$TARGET_DIR"
    fi
  else
    log_warn "git could not be installed. Falling back to downloading archive tarball from GitHub..."
    mkdir -p "$TARGET_DIR"
    curl -fsSL "https://github.com/ardhanata/snoomp/archive/refs/heads/${ARG_BRANCH}.tar.gz" | tar -xz -C "$TARGET_DIR" --strip-components=1
    cd "$TARGET_DIR"
  fi

  log_success "Repository ready in ${TARGET_DIR}. Continuing installation..."
  chmod +x ./install.sh
  exec ./install.sh "$@"
fi

# Fallback non-interactive mode if running piped without a TTY
if [ ! -t 0 ] && [ ! -e /dev/tty ]; then
  UNATTENDED=true
fi

# TTY-aware input reader helper
read_input() {
  local prompt_text="$1"
  local var_name="$2"
  local is_secret="${3:-false}"
  local val=""

  if [ "$is_secret" = "true" ]; then
    if [ -t 0 ]; then
      read -r -s -p "$prompt_text" val
    elif [ -e /dev/tty ]; then
      read -r -s -p "$prompt_text" val </dev/tty
    fi
    echo ""
  else
    if [ -t 0 ]; then
      read -r -p "$prompt_text" val
    elif [ -e /dev/tty ]; then
      read -r -p "$prompt_text" val </dev/tty
    fi
  fi
  printf -v "$var_name" '%s' "$val"
}

echo -e "${BOLD}"
echo "  ┌─────────────────────────────────────────────────────────┐"
echo "  │                  Snoomp Setup & Deploy                  │"
echo "  │        Enterprise Multi-Protocol Health Platform        │"
echo "  └─────────────────────────────────────────────────────────┘"
echo -e "${NC}"

# 1. Dependency checks
log_info "Verifying host prerequisites..."

# Check Docker
if ! command -v docker >/dev/null 2>&1; then
  log_error "Docker is not installed."
  echo "  Install Docker using: curl -fsSL https://get.docker.com | sh"
  echo "  Then add your user to docker group: sudo usermod -aG docker \$USER"
  exit 1
fi

# Check Docker Compose (v2 plugin or standalone)
DOCKER_COMPOSE_CMD=""
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker-compose"
else
  log_error "Docker Compose (v2 plugin or standalone docker-compose) is required."
  echo "  Install Compose plugin: sudo apt-get install docker-compose-plugin (or distro equivalent)"
  exit 1
fi
log_success "Found Docker & Compose ($($DOCKER_COMPOSE_CMD version --short 2>/dev/null || echo 'v2 ready'))"

# Check OpenSSL
if ! command -v openssl >/dev/null 2>&1; then
  log_error "openssl is required to generate cryptographic secrets."
  exit 1
fi

# Check curl
if ! command -v curl >/dev/null 2>&1; then
  log_error "curl is required for deployment verification."
  exit 1
fi

# Verify Docker daemon is accessible
if ! docker info >/dev/null 2>&1; then
  log_error "Cannot connect to the Docker daemon. Is Docker running? Do you have permissions (sudo usermod -aG docker \$USER)?"
  exit 1
fi
log_success "Docker daemon is reachable and responding."

# 2. Configure .env
log_info "Checking environment configuration..."

if [ ! -f .env ]; then
  log_info "Creating .env from .env.example..."
  cp .env.example .env
fi

# Function to read or update .env key
set_env_var() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

get_env_var() {
  local key="$1"
  grep "^${key}=" .env | cut -d'=' -f2- | tr -d '\r"' || true
}

# Auto-generate JWT_SECRET if empty
CURRENT_JWT="$(get_env_var JWT_SECRET)"
if [ -z "$CURRENT_JWT" ]; then
  NEW_JWT="$(openssl rand -base64 48)"
  set_env_var "JWT_SECRET" "$NEW_JWT"
  log_success "Generated strong cryptographic JWT_SECRET."
fi

# Auto-generate POSTGRES_PASSWORD if empty
CURRENT_PG_PASS="$(get_env_var POSTGRES_PASSWORD)"
if [ -z "$CURRENT_PG_PASS" ]; then
  NEW_PG_PASS="$(openssl rand -base64 32)"
  set_env_var "POSTGRES_PASSWORD" "$NEW_PG_PASS"
  log_success "Generated strong random POSTGRES_PASSWORD."
fi

# Network / Port configuration
DETECTED_HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")"
CURRENT_PORT="$(get_env_var SNOOMP_PORT)"
[ -z "$CURRENT_PORT" ] && CURRENT_PORT="8008"

CURRENT_BIND="$(get_env_var SNOOMP_BIND_IP)"
[ -z "$CURRENT_BIND" ] && CURRENT_BIND="0.0.0.0"

CURRENT_ORIGINS="$(get_env_var ALLOWED_ORIGINS)"
[ -z "$CURRENT_ORIGINS" ] && CURRENT_ORIGINS="http://localhost:${CURRENT_PORT}"

if [ "$UNATTENDED" = false ]; then
  # Interactive mode prompts
  echo ""
  echo -e "${BOLD}Server Network Configuration:${NC}"

  # Port
  read_input "Enter host port to expose Snoomp [$CURRENT_PORT]: " INPUT_PORT
  CHOSEN_PORT="${INPUT_PORT:-$CURRENT_PORT}"

  # Bind IP
  read_input "Bind interface (0.0.0.0 for public, 127.0.0.1 for reverse proxy) [$CURRENT_BIND]: " INPUT_BIND
  CHOSEN_BIND="${INPUT_BIND:-$CURRENT_BIND}"

  # Domain / External Hostname
  read_input "External Domain or Server IP (e.g. $DETECTED_HOST_IP or snoomp.mydomain.com): " INPUT_DOMAIN
  CHOSEN_DOMAIN="${INPUT_DOMAIN:-$DETECTED_HOST_IP}"

  # Admin Password
  read_input "Custom first-run admin password (press ENTER to auto-generate): " INPUT_PASS true
  CHOSEN_PASS="${INPUT_PASS:-}"
else
  CHOSEN_PORT="${ARG_PORT:-$CURRENT_PORT}"
  CHOSEN_BIND="${ARG_BIND_IP:-$CURRENT_BIND}"
  CHOSEN_DOMAIN="${ARG_DOMAIN:-$DETECTED_HOST_IP}"
  CHOSEN_PASS="${ARG_ADMIN_PASS:-}"
fi

set_env_var "SNOOMP_PORT" "$CHOSEN_PORT"
set_env_var "SNOOMP_BIND_IP" "$CHOSEN_BIND"

# Build ALLOWED_ORIGINS list
NEW_ORIGINS="http://localhost:${CHOSEN_PORT},http://127.0.0.1:${CHOSEN_PORT}"
if [ -n "$CHOSEN_DOMAIN" ]; then
  if [[ "$CHOSEN_DOMAIN" =~ ^https?:// ]]; then
    NEW_ORIGINS="${NEW_ORIGINS},${CHOSEN_DOMAIN}"
  else
    NEW_ORIGINS="${NEW_ORIGINS},http://${CHOSEN_DOMAIN}:${CHOSEN_PORT},https://${CHOSEN_DOMAIN}"
  fi
fi
set_env_var "ALLOWED_ORIGINS" "$NEW_ORIGINS"

if [ -n "$CHOSEN_PASS" ]; then
  set_env_var "SNOOMP_ADMIN_PASSWORD" "$CHOSEN_PASS"
fi

log_success "Environment configuration saved to .env."

# 3. Build and launch containers
echo ""
log_info "Building and launching Snoomp Docker stack..."
$DOCKER_COMPOSE_CMD up -d --build

# 4. Wait for services to be healthy
echo ""
log_info "Waiting for database and API startup..."

WAIT_SECONDS=0
MAX_WAIT=75
API_HEALTH_URL="http://127.0.0.1:${CHOSEN_PORT}/api/version"

until curl -s -f "$API_HEALTH_URL" >/dev/null 2>&1; do
  sleep 3
  WAIT_SECONDS=$((WAIT_SECONDS + 3))
  if [ $WAIT_SECONDS -ge $MAX_WAIT ]; then
    log_warn "API took longer than expected to respond. Checking container logs..."
    $DOCKER_COMPOSE_CMD ps
    $DOCKER_COMPOSE_CMD logs --tail 30 api
    break
  fi
  printf "."
done
echo ""

if curl -s -f "$API_HEALTH_URL" >/dev/null 2>&1; then
  API_VERSION="$(curl -s "$API_HEALTH_URL" | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || echo 'active')"
  log_success "Snoomp API & UI is healthy (version: ${API_VERSION})!"
else
  log_warn "API health endpoint could not be verified automatically, but containers are started."
fi

# 5. Optional: Systemd service installation
if [ "$INSTALL_SERVICE" = true ] || { [ "$UNATTENDED" = false ] && [ -d /etc/systemd/system ]; }; then
  if [ "$INSTALL_SERVICE" = false ]; then
    read_input "Install Snoomp as a systemd service for auto-boot? [y/N]: " INSTALL_SYS_RESP
    if [[ "$INSTALL_SYS_RESP" =~ ^[Yy]$ ]]; then
      INSTALL_SERVICE=true
    fi
  fi

  if [ "$INSTALL_SERVICE" = true ]; then
    if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
      log_warn "Cannot install systemd service without root or sudo."
    else
      SUDO_CMD=""
      [ "$(id -u)" -ne 0 ] && SUDO_CMD="sudo"
      SERVICE_FILE="/etc/systemd/system/snoomp.service"
      
      log_info "Installing systemd service to ${SERVICE_FILE}..."
      $SUDO_CMD bash -c "cat <<EOF > ${SERVICE_FILE}
[Unit]
Description=Snoomp Enterprise Infrastructure Health Platform
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${DOCKER_COMPOSE_CMD} up -d
ExecStop=${DOCKER_COMPOSE_CMD} down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF"
      $SUDO_CMD systemctl daemon-reload
      $SUDO_CMD systemctl enable snoomp.service
      log_success "systemd service 'snoomp.service' installed and enabled on boot."
    fi
  fi
fi

# 6. Summary & Credentials
echo ""
echo -e "${BOLD}${GREEN}======================================================================${NC}"
echo -e "${BOLD}  Snoomp Deployment Successful! 🚀${NC}"
echo -e "${BOLD}${GREEN}======================================================================${NC}"
echo ""
echo -e "  • Dashboard URL:   ${BOLD}${CYAN}http://${CHOSEN_DOMAIN}:${CHOSEN_PORT}${NC}"
echo -e "  • Local URL:       ${BOLD}http://127.0.0.1:${CHOSEN_PORT}${NC}"
echo -e "  • Username:        ${BOLD}admin${NC}"

# Find auto-generated admin password from logs if not explicitly set
if [ -z "$CHOSEN_PASS" ]; then
  ADMIN_LOG="$($DOCKER_COMPOSE_CMD logs api 2>/dev/null | grep -A4 "SNOOMP FIRST-RUN" || true)"
  if [ -n "$ADMIN_LOG" ]; then
    echo ""
    echo -e "  ${YELLOW}${ADMIN_LOG}${NC}"
  else
    echo -e "  • Admin Password:  (Check 'docker compose logs api | grep -A5 FIRST-RUN')"
  fi
else
  echo -e "  • Admin Password:  ${BOLD}${CHOSEN_PASS}${NC}"
fi

echo ""
echo -e "${BOLD}Operational Commands:${NC}"
echo "  • View live logs:     ${DOCKER_COMPOSE_CMD} logs -f"
echo "  • Restart stack:      ${DOCKER_COMPOSE_CMD} restart"
echo "  • Stop stack:         ${DOCKER_COMPOSE_CMD} down"
echo "  • Update stack:       git pull && ${DOCKER_COMPOSE_CMD} up -d --build"
echo "  • Backup instance:    ./scripts/backup.sh"
echo "  • Restore instance:   ./scripts/restore.sh <backup-file>"
echo ""
