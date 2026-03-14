# Production Deployment Guide

## Overview

This guide covers deploying **Process Manager** as a production-ready infrastructure service with systemd integration, persistent state recovery, and configuration management.

## System Requirements

- Linux system with systemd
- Node.js >= 12.0.0
- npm >= 6.0.0
- Root/sudo access for system-wide installation

## Installation Methods

### Method 1: Quick Install (Recommended)

```bash
# Clone or navigate to project directory
cd /home/kali/Desktop

# Run automated installation
sudo npm run install-service
```

This will:
- Install dependencies
- Create `/opt/process-manager` directory
- Create `/usr/local/bin/pm-daemon` symlink
- Create `/etc/process-manager/` config directory
- Install systemd service file
- Create data directory at `~/.process-manager`

### Method 2: Manual Installation

```bash
# 1. Install dependencies
npm install

# 2. Create system directories
sudo mkdir -p /opt/process-manager
sudo mkdir -p /etc/process-manager
sudo mkdir -p ~/.process-manager

# 3. Copy files
sudo cp -r . /opt/process-manager/

# 4. Create daemon symlink
sudo ln -s /opt/process-manager/bin/daemon.js /usr/local/bin/pm-daemon

# 5. Install systemd service
sudo cp systemd/process-manager.service /etc/systemd/system/
sudo systemctl daemon-reload

# 6. Create default config
/opt/process-manager/bin/daemon.js --create-config /etc/process-manager/config.yaml
```

## Configuration

### Configuration File Locations

- **User-specific**: `~/.process-manager/config.yaml`
- **System-wide**: `/etc/process-manager/config.yaml` (after installation)

### Configuration Options

```yaml
daemon:
  # Port for API (future feature)
  port: 9876
  
  # Host binding
  host: localhost
  
  # Enable Unix socket IPC
  enableSocket: true
  
  # Logging level: error, warn, info, debug
  logLevel: info

processes:
  # Automatically start marked processes on daemon startup
  autoStart: true
  
  # Automatically restart crashed processes
  autoRestart: true
  
  # Delay before restart attempt (ms)
  restartDelay: 1000
  
  # Timeout for graceful shutdown (ms)
  gracefulShutdownTimeout: 5000

persistence:
  # Enable state persistence
  enabled: true
  
  # Periodic save interval (ms)
  saveInterval: 10000
  
  # Data directory (null = ~/.process-manager)
  dataDirectory: null

environment:
  # Global environment variables
  NODE_ENV: production
```

### Modify Configuration

```bash
# View current configuration
pm-daemon --show-config

# Create custom configuration
pm-daemon --create-config /etc/process-manager/prod.yaml

# Edit configuration
sudo nano /etc/process-manager/config.yaml
```

## Service Management

### Start Service

```bash
# Start immediately
sudo systemctl start process-manager

# Enable on boot
sudo systemctl enable process-manager

# Check status
sudo systemctl status process-manager
```

### Monitor Service

```bash
# View logs in real-time
sudo journalctl -u process-manager -f

# View last 50 log lines
sudo journalctl -u process-manager -n 50

# View logs since boot
sudo journalctl -u process-manager --since today

# View only errors
sudo journalctl -u process-manager -p err
```

### Stop Service

```bash
# Graceful stop (default timeout 30s)
sudo systemctl stop process-manager

# Force stop
sudo systemctl kill -s KILL process-manager

# Restart service
sudo systemctl restart process-manager

# Reload configuration
sudo systemctl reload process-manager
```

## Process Management

### Using the CLI Client

```bash
# Start interactive CLI
pm

# Available commands:
pm> daemon-status         # Show daemon status
pm> daemon-config         # Show configuration
pm> daemon-start          # Start daemon
pm> daemon-stop           # Stop daemon
pm> help                  # Show all commands
pm> exit                  # Exit CLI
```

### Using Socket IPC (Advanced)

The daemon communicates via Unix socket at `~/.process-manager/daemon.sock`

```bash
# Check socket
ls -la ~/.process-manager/daemon.sock

# Send commands via socket (see daemon-client.js for implementation)
```

## Data Files

All persistent data is stored in `~/.process-manager/`:

```
~/.process-manager/
├── daemon.pid       # Daemon process ID
├── daemon.sock      # Unix socket for IPC
├── state.json       # Persisted process state
└── config.yaml      # Configuration file
```

### State File Format

```json
{
  "version": 1,
  "timestamp": "2026-01-24T10:30:00.000Z",
  "processes": [
    {
      "name": "web-server",
      "command": "node",
      "args": ["server.js"],
      "cwd": "/opt/app",
      "env": {},
      "autoStart": true,
      "restarts": 2
    }
  ]
}
```

## Boot Recovery Process

When the system boots:

1. systemd loads the process-manager service
2. Service reads config from `/etc/process-manager/config.yaml`
3. Daemon loads state from `~/.process-manager/state.json`
4. For each process with `autoStart: true`:
   - Daemon spawns the process
   - Initializes PID and uptime tracking
   - Sets up crash handlers
5. Daemon listens on socket for commands
6. State is saved periodically
7. On graceful shutdown, all processes are stopped and state is saved

## Troubleshooting

### Service Won't Start

```bash
# Check for errors
sudo journalctl -u process-manager -n 20

# Verify configuration
npm run test:integration

# Check file permissions
ls -la ~/.process-manager/
```

### Processes Not Starting

```bash
# Check daemon is running
sudo systemctl status process-manager

# Check state file
cat ~/.process-manager/state.json

# Verify autoStart flag is set
```

### Permission Denied Errors

```bash
# Check data directory permissions
chmod 755 ~/.process-manager

# Check config file permissions
sudo chmod 644 /etc/process-manager/config.yaml

# Run daemon as specific user
sudo usermod -a -G process-manager $USER
```

### High Memory Usage

```bash
# Check process details
sudo systemctl status process-manager

# View daemon logs for issues
sudo journalctl -u process-manager --grep="error" -n 50

# Reduce save interval in config
sudo nano /etc/process-manager/config.yaml
# Increase saveInterval (e.g., 30000 for 30 seconds)
```

## Uninstallation

```bash
# Stop service
sudo systemctl stop process-manager

# Disable from boot
sudo systemctl disable process-manager

# Remove systemd service
sudo rm /etc/systemd/system/process-manager.service
sudo systemctl daemon-reload

# Remove installation
sudo rm -rf /opt/process-manager
sudo rm /usr/local/bin/pm-daemon

# Remove configuration
sudo rm -rf /etc/process-manager
```

## Security Considerations

### File Permissions

```bash
# Data directory: user only
chmod 700 ~/.process-manager

# Config directory: root only
sudo chmod 700 /etc/process-manager

# Config file: root only
sudo chmod 600 /etc/process-manager/config.yaml
```

### Service User

Consider running as dedicated user for better security:

```bash
# Create service user
sudo useradd -r -s /bin/false process-manager

# Set permissions
sudo chown -R process-manager:process-manager /opt/process-manager
sudo chown -R process-manager:process-manager ~/.process-manager

# Update systemd service
# Edit /etc/systemd/system/process-manager.service
# Change User=process-manager
```

### Network Security

- Daemon only listens on Unix socket (not network)
- No network exposure by default
- All communication is local

## Performance Tuning

### High-Frequency Saves

For systems with many processes, adjust save interval:

```yaml
persistence:
  saveInterval: 30000  # 30 seconds instead of 10
```

### Large Process Count

For managing hundreds of processes:

```yaml
processes:
  gracefulShutdownTimeout: 30000  # Longer timeout
```

## Monitoring

### systemd Integration

```bash
# Monitor via systemd
sudo systemctl status process-manager --full

# CPU and memory
ps aux | grep pm-daemon
```

### Custom Monitoring

The daemon logs all events to systemd journal:

```bash
# Monitor starts/stops
sudo journalctl -u process-manager | grep -E "(start|stop|restart)"

# Monitor errors
sudo journalctl -u process-manager -p err
```

## Backup and Recovery

### Backup State

```bash
# Backup process state
cp ~/.process-manager/state.json ~/.process-manager/state.json.backup

# Backup configuration
sudo cp /etc/process-manager/config.yaml /etc/process-manager/config.yaml.backup
```

### Restore State

```bash
# Restore from backup
cp ~/.process-manager/state.json.backup ~/.process-manager/state.json

# Restart daemon
sudo systemctl restart process-manager
```

## Support and Development

### Enable Debug Logging

```bash
# Edit config
sudo nano /etc/process-manager/config.yaml

# Change logLevel
daemon:
  logLevel: debug

# Restart daemon
sudo systemctl restart process-manager

# View debug logs
sudo journalctl -u process-manager -f
```

### Running Tests

```bash
# Core functionality tests
npm test

# Infrastructure tests
npm run test:integration

# Run examples
npm run example
npm run infrastructure
```

## Production Checklist

- [ ] Install Node.js and npm
- [ ] Clone/download project
- [ ] Run `sudo npm run install-service`
- [ ] Review `/etc/process-manager/config.yaml`
- [ ] Enable service: `sudo systemctl enable process-manager`
- [ ] Start service: `sudo systemctl start process-manager`
- [ ] Verify: `sudo systemctl status process-manager`
- [ ] Check logs: `sudo journalctl -u process-manager -f`
- [ ] Test recovery by rebooting system
- [ ] Backup configuration and state files
- [ ] Set up monitoring/alerting if needed

## Version Information

- **Process Manager**: 1.0.0
- **Node.js**: >= 12.0.0
- **systemd**: >= 200
