#!/bin/bash

# Installation script for process-manager
# This script installs the process-manager as a systemd service

set -e

INSTALL_DIR="/opt/process-manager"
BIN_LINK="/usr/local/bin/pm-daemon"
CONFIG_DIR="/etc/process-manager"
SYSTEMD_DIR="/etc/systemd/system"

echo "🚀 Installing Process Manager..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ This script must be run as root (use sudo)"
  exit 1
fi

# Create installation directory
echo "📁 Creating installation directory..."
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/"

# Install dependencies
echo "📦 Installing dependencies..."
cd "$INSTALL_DIR"
npm install --production

# Create symlink to daemon
echo "🔗 Creating command symlink..."
cat > "$BIN_LINK" << 'EOF'
#!/bin/bash
/usr/bin/node /opt/process-manager/bin/daemon.js "$@"
EOF
chmod +x "$BIN_LINK"

# Create config directory
echo "📋 Setting up configuration..."
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_DIR/config.yaml" ]; then
  cp examples/config.yaml "$CONFIG_DIR/config.yaml" 2>/dev/null || echo "# Process Manager Configuration" > "$CONFIG_DIR/config.yaml"
fi
chmod 755 "$CONFIG_DIR"

# Install systemd service
echo "🔧 Installing systemd service..."
cp systemd/process-manager.service "$SYSTEMD_DIR/"
systemctl daemon-reload

# Create data directory
echo "📂 Creating data directory..."
mkdir -p ~/.process-manager
chmod 755 ~/.process-manager

echo ""
echo "✅ Installation complete!"
echo ""
echo "📖 Next steps:"
echo "  1. Configure the service (optional):"
echo "     sudo nano $CONFIG_DIR/config.yaml"
echo ""
echo "  2. Enable the service to start on boot:"
echo "     sudo systemctl enable process-manager"
echo ""
echo "  3. Start the service:"
echo "     sudo systemctl start process-manager"
echo ""
echo "  4. Check status:"
echo "     sudo systemctl status process-manager"
echo ""
echo "  5. View logs:"
echo "     sudo journalctl -u process-manager -f"
echo ""
