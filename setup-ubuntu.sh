#!/bin/bash
set -e

echo "=== SyncNo Setup ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  echo "[1/6] Installing Docker..."
  apt-get update
  apt-get install -y ca-certificates curl gnupg lsb-release
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin git
  systemctl enable docker
else
  echo "[1/6] Docker already installed, skipping..."
fi

# Pull latest code
echo "[2/6] Pulling latest code..."
if [ -d /opt/syncno ]; then
  cd /opt/syncno && git pull origin main
else
  git clone https://github.com/Elliotts/syncno-app.git /opt/syncno
  cd /opt/syncno
fi

# Create .env file
echo "[3/6] Creating environment file..."
ENV_FILE="/opt/syncno/.env"
if [ -f "$ENV_FILE" ]; then
  echo ".env exists, backing up to .env.bak"
  cp "$ENV_FILE" "$ENV_FILE.bak"
fi

echo "Enter the following secrets (press Enter to skip):"

read -p "NEXTAUTH_SECRET (generate with: openssl rand -base64 32): " NEXTAUTH_SECRET
read -p "NEXTAUTH_URL (public URL, e.g. https://syncno.yourdomain.com): " NEXTAUTH_URL
read -p "SYNCRO_API_KEY: " SYNCRO_API_KEY
read -p "SYNCRO_SUBDOMAIN: " SYNCRO_SUBDOMAIN
read -p "Azure Client ID: " AZURE_CLIENT_ID
read -p "Azure Client Secret: " AZURE_CLIENT_SECRET
read -p "Azure Tenant ID: " AZURE_TENANT_ID

# Generate default NEXTAUTH_SECRET if empty
if [ -z "$NEXTAUTH_SECRET" ]; then
  NEXTAUTH_SECRET=$(openssl rand -base64 32)
fi

cat > "$ENV_FILE" << EOF
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXTAUTH_URL=${NEXTAUTH_URL:-http://localhost:3001}
NEXT_PUBLIC_API_URL=http://backend:3002/api
SYNCRO_API_KEY=${SYNCRO_API_KEY}
SYNCRO_SUBDOMAIN=${SYNCRO_SUBDOMAIN}
AZURE_CLIENT_ID=${AZURE_CLIENT_ID}
AZURE_CLIENT_SECRET=${AZURE_CLIENT_SECRET}
AZURE_TENANT_ID=${AZURE_TENANT_ID}
EOF

echo ".env created at $ENV_FILE"

# Build and start containers
echo "[4/6] Building and starting containers..."
cd /opt/syncno
docker compose build
docker compose up -d

# Wait for containers to be healthy
echo "[5/6] Waiting for services..."
sleep 10

# Check status
if docker compose ps | grep -q "Up"; then
  echo "Containers started successfully!"
  docker compose ps
else
  echo "Container startup may have failed. Check logs with: docker compose logs"
fi

# Create systemd service
echo "[6/6] Creating systemd service..."
SERVICE_FILE="/etc/systemd/system/syncno.service"
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=SyncNo Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=true
WorkingDirectory=/opt/syncno
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable syncno.service

echo ""
echo "=== Setup Complete ==="
echo "Frontend: http://localhost:3001"
echo "Backend API: http://localhost:3002"
echo ""
echo "Service commands:"
echo "  sudo systemctl start syncno    # start"
echo "  sudo systemctl stop syncno     # stop"
echo "  sudo systemctl restart syncno  # restart"
echo "  sudo systemctl status syncno   # status"
echo "  docker compose -f /opt/syncno/docker-compose.yml logs -f  # view logs"
