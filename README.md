# ⚓ ANCHOR - Cloud Infrastructure Platform

A complete Node.js infrastructure platform for managing game servers, microservices, containerized applications, and cloud workloads across distributed clusters. Built in five phases: process management engine, game server layer, web API platform, container orchestration, and cluster management.

ANCHOR evolves beyond gaming into a general-purpose cloud orchestration platform supporting:

- **Game Servers**: Minecraft, CS:GO, Rust, Valheim
- **Web Hosting**: Node.js apps, Python APIs, Next.js websites, static sites
- **Backend APIs**: Microservices, authentication, payment APIs, chat servers
- **Data Processing**: Analytics pipelines, AI inference, video processing, batch jobs
- **AI Model Hosting**: LLMs, computer vision, recommendation systems

## Architecture Overview

```text
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
│ Security     │ Templates    │ Stats        │ Health │
└──────────────┴──────────────┴──────────────┴────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────┐
│         GAME SERVER MANAGER                         │
│  Multi-runtime orchestration layer                  │
├──────────────┬──────────────┬──────────────┬────────┤
│ Docker       │ Native Node  │ Resource     │ Config │
│ Containers   │ Processes    │ Limits       │ Mgmt   │
│ Templates    │ Templates    │ Monitoring   │        │
└──────────────┴──────────────┴──────────────┴────────┘
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Process     │ │ Docker       │ │ Log Stream   │
│  Manager     │ │ Adapter      │ │ Service      │
│  (PID)       │ │ (Stats)      │ │ (WebSocket)  │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Features

### 🐳 Container Orchestration

- **Docker First**: Automatic container deployment for game servers
- **Resource Limits**: CPU and memory constraints per server
- **Port Mapping**: Automatic port allocation and forwarding
- **Image Management**: Auto-pull and caching of game server images

### 🎮 Game Server Templates

Pre-configured templates for popular games:

- **Minecraft**: Vanilla/Paper servers with EULA handling
- **CS:GO**: Source dedicated server with RCON
- **Rust**: Oxide mod support with RCON
- **Valheim**: Crossplay server configuration

### 🌐 Web Hosting Platform

Deploy web applications with automatic domain assignment and load balancing:

- **Node.js Apps**: Express, Next.js, Nuxt.js
- **Python APIs**: Flask, FastAPI, Django
- **Static Websites**: HTML/CSS/JS with CDN
- **Global Routing**: Regional deployment with global load balancing

Example deployment:
```json
POST /api/apps/deploy
{
  "name": "my-website",
  "image": "node:18",
  "region": "eu-west",
  "memory": "512MB"
}
```

### 📦 Backend API Hosting

Host microservices with automatic scaling and monitoring:

- **Authentication Services**: JWT, OAuth providers
- **Payment APIs**: Stripe, PayPal integrations
- **Chat Servers**: Real-time messaging platforms
- **AI Inference APIs**: Model serving endpoints

Example service deployment:
```json
POST /api/services
{
  "name": "chat-service",
  "image": "mycompany/chat-api",
  "replicas": 3
}
```

### 📊 Data Processing Platform

Run data workloads and batch jobs:

- **Analytics Pipelines**: ETL processes, data transformation
- **AI Model Inference**: Batch prediction jobs
- **Video Processing**: Encoding, transcoding tasks
- **Batch Jobs**: Scheduled data processing

Example job submission:
```json
POST /api/jobs
{
  "image": "python:ml-model",
  "task": "analyze-data"
}
```

### 🧠 AI Model Hosting

Deploy and serve AI models with GPU support:

- **Large Language Models**: Llama, GPT variants
- **Computer Vision**: Image recognition, object detection
- **Recommendation Systems**: Personalized content algorithms
- **GPU Acceleration**: Automatic GPU node allocation

Example AI deployment:
```json
POST /api/ai/deploy
{
  "model": "llama-3",
  "gpu": true
}
```

### 📊 Real-time Monitoring

- **WebSocket Updates**: Live server status and logs
- **Resource Stats**: CPU, memory, and network usage
- **Health Checks**: Platform and server health endpoints
- **Structured Logging**: Winston-based logging system

### 🔒 Enterprise Security

- **JWT Authentication**: Secure API access
- **Rate Limiting**: DDoS protection (100 req/15min)
- **Helmet.js**: HTTP security headers
- **Input Validation**: Joi schema validation

### ⚖️ Player Matchmaking Integration

Intelligent matchmaking system that combines player skill levels with global server routing for optimal multiplayer experiences.

- **Skill-Based Matching**: MMR tolerance system (±200 MMR range)
- **Regional Preferences**: Players matched in preferred regions when possible
- **Game Mode Separation**: Separate queues for ranked, casual, and custom modes
- **Dynamic Server Allocation**: Automatic server deployment for new matches
- **Queue Management**: Real-time queue processing with wait time optimization

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

## API Documentation

### Authentication

```bash
# Login
POST /api/auth/login
{
  "username": "admin",
  "password": "admin"
}

# Response
{
  "success": true,
  "token": "jwt_token_here"
}
```

Use the token in `Authorization: Bearer <token>` header for all API calls.

### Game Server Management

```bash
# Get available templates
GET /api/templates

# Create server
POST /api/servers
{
  "name": "my-minecraft-server",
  "type": "minecraft",
  "options": {
    "env": {
      "MOTD": "Welcome to ANCHOR!"
    }
  }
}

# List servers
GET /api/servers

# Get server status
GET /api/servers/{name}

# Start server
POST /api/servers/{name}/start

# Stop server
POST /api/servers/{name}/stop

# Restart server
POST /api/servers/{name}/restart

# Get server stats
GET /api/servers/{name}/stats

# Set resource limits
POST /api/servers/{name}/limits
{
  "memory": "4096m",
  "cpus": "2.0"
}

# Delete server
DELETE /api/servers/{name}
```

### Web Application Deployment

```bash
# Deploy web application
POST /api/apps/deploy
{
  "name": "my-website",
  "image": "node:18",
  "region": "eu-west",
  "memory": "512MB",
  "domain": "myapp.anchor.dev"  // optional custom domain
}

# List deployed apps
GET /api/apps

# Get app status
GET /api/apps/{name}

# Scale app
POST /api/apps/{name}/scale
{
  "replicas": 3
}

# Update app
POST /api/apps/{name}/update
{
  "image": "node:20"
}

# Delete app
DELETE /api/apps/{name}
```

### Backend Service Deployment

```bash
# Deploy microservice
POST /api/services
{
  "name": "chat-service",
  "image": "mycompany/chat-api",
  "replicas": 3,
  "env": {
    "DATABASE_URL": "postgres://..."
  }
}

# List services
GET /api/services

# Get service status
GET /api/services/{name}

# Scale service
POST /api/services/{name}/scale
{
  "replicas": 5
}

# Update service
POST /api/services/{name}/update
{
  "image": "mycompany/chat-api:v2"
}

# Delete service
DELETE /api/services/{name}
```

### Data Processing Jobs

```bash
# Submit batch job
POST /api/jobs
{
  "name": "data-analysis",
  "image": "python:ml-model",
  "task": "analyze-data",
  "schedule": "0 */6 * * *"  // optional cron schedule
}

# List jobs
GET /api/jobs

# Get job status
GET /api/jobs/{name}

# Cancel job
DELETE /api/jobs/{name}
```

### AI Model Deployment

```bash
# Deploy AI model
POST /api/ai/deploy
{
  "name": "llama-chat",
  "model": "llama-3",
  "gpu": true,
  "replicas": 2
}

# List AI deployments
GET /api/ai

# Get model status
GET /api/ai/{name}

# Scale model
POST /api/ai/{name}/scale
{
  "replicas": 4
}

# Delete model
DELETE /api/ai/{name}
```

### Health & Monitoring

```bash
# Platform health
GET /api/health

# Server logs
GET /api/servers/{name}/logs?limit=100

# App logs
GET /api/apps/{name}/logs?limit=100

# Service logs
GET /api/services/{name}/logs?limit=100
```

### AI Scaling Engine

ANCHOR includes intelligent auto-scaling capabilities that automatically manage server capacity based on player load.

```bash
# Get scaling statistics
GET /api/scaling/stats

# Record server metrics (for scaling decisions)
POST /api/scaling/metrics
{
  "serverId": "my-server",
  "metrics": {
    "players": 15,
    "maxPlayers": 20,
    "cpu": 65,
    "memory": 1024
  }
}

# Get predictive scaling recommendations
GET /api/scaling/predictions/{serverId}
```

#### Scaling Configuration

Configure scaling behavior via environment variables:

```bash
# Scaling check interval (30 seconds)
SCALING_CHECK_INTERVAL=30000

# Scale up at 80% utilization
SCALE_UP_THRESHOLD=0.8

# Scale down at 20% utilization
SCALE_DOWN_THRESHOLD=0.2

# Shutdown idle servers after 20 minutes
IDLE_TIMEOUT=1200000

# Enable predictive scaling
PREDICTIVE_SCALING=true
```

#### How Auto-Scaling Works

1. **Reactive Scaling**: Monitors server utilization every 30 seconds
2. **Scale Up**: Creates new server instances when load exceeds 80%
3. **Scale Down**: Removes excess capacity when utilization drops below 20%
4. **Cost Optimization**: Automatically shuts down idle servers after 20 minutes
5. **Predictive Scaling**: Learns usage patterns and preemptively scales for expected load spikes

### Plugin Ecosystem

ANCHOR supports a rich plugin ecosystem that allows developers to extend platform functionality into a full cloud marketplace.

```bash
# List loaded plugins
GET /api/plugins

# Reload a plugin
POST /api/plugins/{pluginName}/reload

# Unload a plugin
DELETE /api/plugins/{pluginName}

# Get analytics (requires analytics plugin)
GET /api/analytics
```

#### Creating Plugins

Plugins are Node.js modules placed in the `./plugins` directory. Each plugin needs:

1. **package.json** with name, version, main file
2. **Main plugin file** extending the Plugin base class

```javascript
const Plugin = require('./src/Plugin.js');

class MyPlugin extends Plugin {
  constructor(options) {
    super(options);
    this.name = 'my-plugin';
    this.events = ['serverCreated', 'scalingUp']; // Events to listen to
  }

  async init(api) {
    await super.init(api);
    this.api.info('My plugin initialized!');
  }

  onEvent(event, data) {
    // Handle events
    if (event === 'serverCreated') {
      this.api.info(`Server created: ${data.serverId}`);
    }
  }
}

module.exports = MyPlugin;
```

#### Plugin API

Plugins have access to:

- **Server Management**: `api.startServer()`, `api.stopServer()`, `api.getServers()`
- **Scaling**: `api.getScalingStats()`, `api.triggerScaleUp()`
- **Nodes**: `api.getNodes()`, `api.getNodeInfo()`
- **Metrics**: `api.getMetrics()`
- **Events**: `api.emit()`, `api.on()`
- **Configuration**: `api.getConfig()`, `api.setConfig()`
- **Logging**: `api.info()`, `api.warn()`, `api.error()`

#### Included Example Plugins

- **Discord Notifier**: Sends server events to Discord channels
- **Analytics**: Tracks usage metrics and generates reports
- **Auto Backup**: Automatic server backups to cloud storage

#### Plugin Marketplace Extensions

The plugin system enables powerful extensions for cloud infrastructure:

- **Domain Manager**: Automatic DNS configuration and SSL certificates
- **Database Provisioning**: PostgreSQL, Redis, MongoDB auto-setup
- **CDN Integration**: Global content delivery for static assets
- **Billing & Usage Tracking**: Resource monitoring and invoice generation
- **Monitoring & Alerting**: Advanced metrics and notification systems

## 🌍 The Bigger Vision

ANCHOR combines the simplicity of Heroku/Vercel with the power of Kubernetes, becoming a developer-friendly cloud platform.

### Unified Deployment API

Deploy any workload type with a simple API:

```json
POST /api/deploy
{
  "type": "web",
  "image": "nextjs-app",
  "region": "global"
}
```

ANCHOR automatically:
- Selects optimal nodes and regions
- Configures scaling policies
- Sets up load balancing
- Manages domains and SSL

### Platform Comparison

| Platform | Focus | Complexity | ANCHOR Advantage |
|----------|-------|------------|------------------|
| Heroku | App hosting | Simple | Multi-runtime + containers |
| Vercel | Frontend | Simple | Full-stack + backend APIs |
| Fly.io | Global apps | Medium | Built-in matchmaking + gaming |
| Kubernetes | Orchestration | Complex | Developer-friendly API |

### ANCHOR Cloud Platform Structure

```
⚓ ANCHOR Cloud Platform
│
├─ 🎮 Game Servers
│   ├─ Minecraft, CS:GO, Rust, Valheim
│   └─ Custom game templates
│
├─ 🌐 Web Hosting
│   ├─ Node.js, Python, static sites
│   └─ Automatic domains & SSL
│
├─ 📦 API Hosting
│   ├─ Microservices & backends
│   └─ Auto-scaling & monitoring
│
├─ 🧠 AI Model Deployment
│   ├─ LLMs, vision models
│   └─ GPU-accelerated inference
│
├─ 📊 Data Processing
│   ├─ Batch jobs & pipelines
│   └─ Scheduled workloads
│
└─ 🔌 Plugin Marketplace
    ├─ Domain management
    ├─ Database provisioning
    ├─ CDN integration
    └─ Billing & analytics
```

## 🚀 Next Big Feature: Domain + HTTPS Management

To enable web hosting and API deployment, ANCHOR needs automatic domain management:

- **DNS Configuration**: Automatic subdomain assignment (myapp.anchor.dev)
- **SSL Certificates**: Let's Encrypt integration for HTTPS
- **Domain Routing**: Global load balancer with domain-based routing
- **Custom Domains**: Support for user-provided domains

This transforms ANCHOR from a gaming platform into a full cloud hosting solution.
- **Auto Backup**: Automatically backs up server data on schedule
- **Analytics**: Collects and analyzes platform usage statistics

#### Plugin Configuration

Configure plugins via environment variables or config files:

```bash
# Plugin directory
PLUGIN_DIR=./plugins

# Plugin-specific config (example for Discord plugin)
# Plugins can access config via this.getConfig('discordToken')
```

### Global Load Balancing

ANCHOR's Global Load Balancer provides intelligent player routing across geographically distributed game servers, optimizing for latency, load, and regional preferences.

#### Register Server

```bash
POST /api/loadbalancer/register-server
{
  "serverId": "us-east-1",
  "region": "us-east",
  "maxPlayers": 1000,
  "players": 200,
  "endpoint": "us-east-1.gameserver.com"
}
```

#### Route Player

```bash
POST /api/loadbalancer/route
{
  "playerId": "player_123",
  "region": "us-east",
  "gameType": "battle-royale",
  "playerCount": 1
}

# Response
{
  "success": true,
  "server": {
    "id": "us-east-1",
    "region": "us-east",
    "endpoint": "us-east-1.gameserver.com",
    "players": 200,
    "maxPlayers": 1000
  }
}
```

#### Get Load Balancer Statistics

```bash
GET /api/loadbalancer/stats

# Response
{
  "success": true,
  "stats": {
    "totalServers": 8,
    "totalCapacity": 7600,
    "totalLoad": 2350,
    "averageUtilization": 30.9,
    "averageLatency": 78,
    "bestRegion": "us-east",
    "regions": {
      "us-east": {
        "serverCount": 1,
        "averageLatency": 34,
        "totalCapacity": 1000,
        "totalLoad": 200
      }
    }
  }
}
```

#### Get Regions

```bash
GET /api/loadbalancer/regions

# Response
{
  "success": true,
  "regions": [
    {
      "id": "us-east",
      "name": "US East",
      "location": "New York, NY"
    }
  ]
}
```

#### Get Servers

```bash
GET /api/loadbalancer/servers

# Response
{
  "success": true,
  "servers": [
    {
      "id": "us-east-1",
      "region": "us-east",
      "players": 200,
      "maxPlayers": 1000,
      "endpoint": "us-east-1.gameserver.com"
    }
  ]
}
```

#### Unregister Server

```bash
DELETE /api/loadbalancer/servers/us-east-1

# Response
{
  "success": true,
  "message": "Server unregistered successfully"
}
```

### Player Matchmaking

ANCHOR's matchmaking system provides intelligent player matching with skill-based algorithms and automatic server allocation.

#### Add Player to Matchmaking Queue

```bash
POST /api/matchmaking/queue
{
  "playerId": "player_123",
  "skill": 1500,
  "preferredRegion": "us-east",
  "gameMode": "ranked",
  "maxWaitTime": 30000
}
```

#### Find Match for Player

```bash
POST /api/matchmaking/find-match
{
  "playerId": "player_123",
  "skill": 1500,
  "preferredRegion": "us-east",
  "gameMode": "ranked"
}

# Response (if match found)
{
  "success": true,
  "match": {
    "id": "match_1",
    "players": ["player_123", "player_456"],
    "gameMode": "ranked",
    "region": "us-east",
    "averageSkill": 1480
  },
  "server": {
    "id": "us-east-1",
    "endpoint": "us-east-1.game.com"
  }
}

# Response (if queued)
{
  "success": true,
  "status": "queued",
  "message": "Player added to matchmaking queue"
}
```

#### Get Matchmaking Queue Status

```bash
GET /api/matchmaking/queue/status

# Response
{
  "success": true,
  "queue": {
    "totalQueued": 8,
    "playersWaiting": 2,
    "matchesCreated": 3,
    "averageWaitTime": 1250,
    "queueByRegion": {
      "us-east": 2,
      "eu-west": 0
    },
    "queueByMode": {
      "ranked": 1,
      "casual": 1
    }
  }
}
```

#### Get Active Matches

```bash
GET /api/matchmaking/matches

# Response
{
  "success": true,
  "matches": [
    {
      "id": "match_1",
      "players": ["player_123", "player_456"],
      "gameMode": "ranked",
      "region": "us-east",
      "averageSkill": 1480,
      "createdAt": "2026-03-14T13:45:17.000Z"
    }
  ]
}
```

#### Remove Player from Queue

```bash
DELETE /api/matchmaking/queue/player_123

# Response
{
  "success": true,
  "message": "Player removed from matchmaking queue"
}
```

sudo systemctl enable process-manager

## Start service

sudo systemctl start process-manager

## View logs

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
- Returns: Promise&lt;ProcessInfo&gt;

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

```text
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
