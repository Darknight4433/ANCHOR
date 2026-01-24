# 🎮 Game Server Platform

A complete Node.js infrastructure platform for managing game servers, microservices, and containerized applications. Built in three phases: process management engine, game server layer, and web API platform.

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│        WEB DASHBOARD (Browser)                      │
│   Login → Server Management → Real-time Logs        │
└────────────────────┬────────────────────────────────┘
                     │ HTTP/WebSocket
                     ↓
┌─────────────────────────────────────────────────────┐
│        REST API SERVER (Express + WebSocket)        │
│     Port 3000: Full CRUD + Real-time Updates        │
├──────────────┬──────────────┬──────────────┬────────┤
│ Auth (JWT)   │ Routing      │ Validation   │ CORS   │
└──────────────┴──────────────┴──────────────┴────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────┐
│         GAME SERVER MANAGER                         │
│  Multi-runtime orchestration layer                  │
├──────────────┬──────────────┬──────────────┬────────┤
│ Docker       │ Native Node  │ Resource     │ Config │
│ Containers   │ Processes    │ Limits       │ Mgmt   │
└──────────────┴──────────────┴──────────────┴────────┘
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Process     │ │ Docker       │ │ Log Stream   │
│  Manager     │ │ Adapter      │ │ Service      │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Installation

```bash
npm install
```

## Quick Start

### Local Mode (Development)

```bash
# Start interactive CLI
npm start

# Run examples
npm run example

# Run tests
npm test
```

### Daemon Mode (Production)

#### System-wide Installation

```bash
# Install as systemd service
sudo npm run install-service

# Enable on boot
sudo systemctl enable process-manager

# Start service
sudo systemctl start process-manager

# View logs
sudo journalctl -u process-manager -f
```

#### Manual Daemon Start

```bash
# Start daemon
npm run daemon

# In another terminal, use CLI commands with daemon-* prefix
npm start
> pm> daemon-status
> pm> daemon-config
```

### As a Module

```javascript
const ProcessManager = require('./src/index.js');

const pm = new ProcessManager();

// Start a process
const info = pm.start('node', ['server.js'], {
  name: 'my-server',
  cwd: '/path/to/project'
});

console.log(`Started process: ${info.pid}`);

// Get process info
const processInfo = pm.getProcessInfo('my-server');
console.log(`Uptime: ${processInfo.uptime}`);

// Stop the process
await pm.stop('my-server');

// Restart the process
await pm.restart('my-server');

// List all processes
const all = pm.getAllProcesses();
console.table(all);

// Stop all processes
await pm.stopAll();
```

### Event Listeners

```javascript
pm.on('start', ({ name, pid }) => {
  console.log(`Process started: ${name} (${pid})`);
});

pm.on('stop', ({ name, pid }) => {
  console.log(`Process stopped: ${name}`);
});

pm.on('restart', ({ name, restarts }) => {
  console.log(`Process restarted: ${name} (${restarts} times)`);
});

pm.on('error', ({ name, error }) => {
  console.error(`Error in ${name}:`, error);
});

pm.on('exit', ({ name, code, signal }) => {
  console.log(`Process exited: ${name} (code: ${code})`);
});
```

### CLI Interface

```bash
# Start the CLI
npm start

# Available commands:
# Daemon Management:
#   daemon-start [config]  - Start daemon service
#   daemon-stop            - Stop daemon service
#   daemon-status          - Show daemon status
#   daemon-config [path]   - Show or set configuration
#
# Process Management:
#   start <command> [args...]  - Start a process
#   stop <name>                - Stop a process
#   restart <name>             - Restart a process
#   list                        - List all processes
#   info <name>                - Get process information
#   help                        - Show available commands
#   exit                        - Exit the CLI
```

## Configuration

### Config File Location

- Default: `~/.process-manager/config.yaml`
- System-wide: `/etc/process-manager/config.yaml` (after installation)

### Configuration Example

```yaml
daemon:
  port: 9876
  enableSocket: true
  logLevel: info

processes:
  autoStart: true
  autoRestart: true
  restartDelay: 1000
  gracefulShutdownTimeout: 5000

persistence:
  enabled: true
  saveInterval: 10000

environment:
  NODE_ENV: production
```

### Modify Configuration via CLI

```bash
# View current config
daemon-config

# Create default config
daemon-config /path/to/config.yaml

# Set a value
daemon-config processes.autoRestart true
```

### Examples

Run the example:
```bash
npm run example
```

Run tests:
```bash
npm test
```

## API Reference

### `ProcessManager`

#### Methods

**`start(command, args, options)`**
- Starts a new process
- Returns: Process info object
- Options: `{ name, cwd, env, stdio }`

**`stop(name, timeout)`**
- Gracefully stops a process
- Returns: Promise
- Timeout in ms (default: 5000)

**`restart(name)`**
- Restarts a process
- Returns: Promise<ProcessInfo>

**`getProcessInfo(name)`**
- Gets information about a process
- Returns: Process info object or null

**`getAllProcesses()`**
- Gets all tracked processes
- Returns: Array of process info objects

**`isRunning(name)`**
- Checks if a process is running
- Returns: boolean

**`stopAll()`**
- Stops all running processes
- Returns: Promise

**`remove(name)`**
- Removes a process from tracking
- Returns: boolean

#### Events

- `start` - Process started
- `stop` - Process stopped
- `restart` - Process restarted
- `error` - Error occurred
- `exit` - Process exited
- `force-kill` - Process force killed

## Use Cases

🎮 **Game Servers**
- Manage multiple game server instances
- Automatic restart on crash
- Monitor uptime and performance

🎛️ **Control Panels**
- Web-based process management
- Real-time monitoring
- Batch operations

🐳 **Docker Orchestration**
- Container process lifecycle
- Health monitoring
- Coordinated shutdown

📊 **PM2-like Systems**
- Process clustering
- Load balancing
- Log aggregation

## Project Structure

```
.
├── bin/
│   ├── cli.js              # CLI interface & daemon commands
│   ├── daemon.js           # Background daemon service
│   └── daemon-client.js    # Client for daemon communication
├── src/
│   ├── index.js            # Core ProcessManager class
│   ├── ConfigManager.js    # Configuration file handling
│   └── PersistenceManager.js # State persistence & recovery
├── systemd/
│   └── process-manager.service  # systemd service file
├── examples/
│   ├── example.js          # Basic usage examples
│   ├── test.js             # Test suite
│   ├── infrastructure.js   # Infrastructure features demo
│   └── config.yaml         # Configuration example
├── install.sh              # Installation script
├── package.json
└── README.md
```

## License

MIT

## Infrastructure Capabilities

### Background Service

The daemon runs as a background process that:
- Survives terminal disconnection
- Persists across process crashes (with systemd)
- Communicates via Unix socket IPC
- Manages multiple processes independently

### Persistent State

All process configurations are saved to disk:
- Automatic periodic saves (configurable interval)
- Survives daemon restarts
- Enables process recovery on boot
- Tracks restart counts and history

### systemd Integration

Full integration with Linux service manager:
- Service file for automatic startup
- Automatic restart on crash
- Integrated logging to journalctl
- Graceful shutdown handling
- Security hardening

### Configuration Management

Flexible configuration system:
- YAML or JSON format
- Default configuration with sensible defaults
- Runtime modification
- Per-process overrides
- Environment variable support

### Boot Recovery

Automatic recovery of processes on system startup:
1. systemd launches process-manager service
2. Daemon loads configuration
3. Daemon recovers persisted processes
4. Processes marked with `autoStart: true` are respawned
5. Restart counts and state are preserved

## Advanced Usage

### Start Daemon with Custom Config

```bash
npm run daemon /etc/process-manager/custom.yaml
```

### Install for Production

```bash
# Install globally with systemd integration
sudo npm run install-service

# Verify installation
sudo systemctl status process-manager

# Check daemon logs
sudo journalctl -u process-manager -n 50 -f
```

### Monitor Daemon

```bash
# Check daemon status from CLI
npm start
> pm> daemon-status

# View system logs
tail -f ~/.process-manager/daemon.log

# Monitor with journalctl
sudo journalctl -u process-manager -f
```
