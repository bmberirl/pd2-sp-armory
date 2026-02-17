#!/bin/bash
# ── PD2 Armory Setup Script ──────────────────────────────────────────────────
# Run this on your Linux server to set up the armory.
#
# Usage:
#   chmod +x setup.sh && sudo ./setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

INSTALL_DIR="/opt/pd2-armory"
SERVICE_USER="$(logname 2>/dev/null || echo $SUDO_USER || echo $USER)"

echo "── PD2 Armory Setup ──────────────────────────"
echo "Install dir: $INSTALL_DIR"
echo "Service user: $SERVICE_USER"
echo ""

# Create directory structure
echo "[1/5] Creating directories..."
mkdir -p "$INSTALL_DIR"/{saves,data,public/images}

# Copy project files (assumes script is run from the project directory)
echo "[2/5] Copying project files..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/server.js" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/package.json" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/public/"* "$INSTALL_DIR/public/"

# Set ownership
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# Install Node.js dependencies
echo "[3/5] Installing npm dependencies..."
cd "$INSTALL_DIR"
sudo -u "$SERVICE_USER" npm install --production

# Install systemd service
echo "[4/5] Installing systemd service..."
cat > /etc/systemd/system/pd2-armory.service <<EOF
[Unit]
Description=PD2 Singleplayer Character Armory
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pd2-armory

echo "[5/5] Setup complete!"
echo ""
echo "── Next Steps ─────────────────────────────────"
echo ""
echo "1. Copy PD2 data files (TXT) to $INSTALL_DIR/data/"
echo "   From your PD2 install: Diablo II/ProjectD2/data/global/excel/"
echo "   Key files: ItemStatCost.txt, Armor.txt, Weapons.txt, Misc.txt,"
echo "   UniqueItems.txt, SetItems.txt, Skills.txt, Properties.txt, string.txt"
echo ""
echo "2. Start the service:"
echo "   sudo systemctl start pd2-armory"
echo ""
echo "3. View at: http://$(hostname -I | awk '{print $1}'):3001"
echo ""
echo "4. Sync saves from Windows PC using sync-saves.bat"
echo ""
echo "── Commands ───────────────────────────────────"
echo "  sudo systemctl start pd2-armory    # Start"
echo "  sudo systemctl stop pd2-armory     # Stop"
echo "  sudo systemctl status pd2-armory   # Status"
echo "  journalctl -u pd2-armory -f        # View logs"
echo ""
