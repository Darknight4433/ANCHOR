# Game Server Platform

Complete infrastructure platform for managing game servers, Docker containers, and processes with a web dashboard.

## 🎯 What You Get

**Phase 1: Core Process Manager** ✓
- Start, stop, restart processes
- PID and uptime tracking
- Event-driven architecture
- Daemon service with systemd integration
- State persistence and recovery

**Phase 2: Game Server Management** ✓ 
- Docker container management
- Pre-configured server types (Minecraft, CS:GO, Rust, etc.)
- Log streaming and rotation
- Resource limits (memory, CPU)
- Native process fallback

**Phase 3: Web Platform** ✓
- REST API with authentication
- Real-time WebSocket updates
- Web dashboard
- JWT token-based auth
- Multi-server management

## 🚀 Architecture

```
┌─────────────────────────────────────────┐
│         Web Dashboard (HTML/JS)         │
│    Real-time server management UI       │
└─────────────────────────────────────────┘
                 ↕ HTTP
┌─────────────────────────────────────────┐
│       REST API Server (Express)         │
│  - Authentication (JWT)                 │
│  - Server lifecycle endpoints           │
│  - WebSocket for real-time updates      │
└─────────────────────────────────────────┘
                 ↕ Commands
┌─────────────────────────────────────────┐
│     Game Server Manager                 │
│  - Lifecycle management                 │
│  - Log streaming                        │
│  - Resource enforcement                 │
└─────────────────────────────────────────┘
        ↕ Orchestrates        ↕ Logs
    ┌────────────┐       ┌──────────────┐
    │   Docker   │       │ Log Stream   │
    │Containers │       │  Service     │
    └────────────┘       └──────────────┘
         ↕ Or
    ┌────────────────────────────────┐
    │ Process Manager + Native       │
    │ Node.js Processes              │
    └────────────────────────────────┘
```

## 📦 Project Structure

```
.
├── bin/
│   ├── cli.js               # CLI interface
│   ├── daemon.js            # Background daemon
│   ├── platform.js          # Platform entry point
│   └── daemon-client.js     # Daemon client
├── src/
│   ├── index.js             # Core ProcessManager
│   ├── ConfigManager.js     # Configuration
│   ├── PersistenceManager.js# State persistence
│   ├── DockerAdapter.js     # Docker abstraction
│   ├── GameServerManager.js # Game server control
│   ├── LogStreamService.js  # Log management
│   └── APIServer.js         # REST API + WebSocket
├── public/
│   ├── dashboard.html       # Main dashboard
│   └── login.html           # Login page
├── systemd/
│   └── process-manager.service
├── examples/
│   ├── platform-demo.js     # Platform demonstration
│   ├── infrastructure.js    # Infrastructure features
│   ├── test.js              # Core tests
│   └── config.yaml          # Config example
└── README.md
```

## 🎮 Features

### Game Server Management
- **Multiple Server Types**: Minecraft, CS:GO, Rust, Valheim, custom
- **Dual Runtime**: Docker containers or native Node.js
- **Automatic Recovery**: Restart crashed servers
- **Lifecycle Control**: Create, start, stop, restart, delete

### Docker Integration
- Container lifecycle management
- Resource limits (memory, CPU)
- Port mapping
- Volume management
- Auto-pull images
- Health monitoring

### Real-time Logging
- Stream logs to WebSocket clients
- File-based persistence
- Log rotation (keep 7 days)
- Search and filter
- Per-server buffering

### Resource Management
- Memory limits per server
- CPU allocation
- Automatic enforcement
- Monitor stats in real-time

### Web Platform
- Beautiful dashboard UI
- Real-time server status
- Create/manage servers via web
- Log viewer with streaming
- Responsive design

### Authentication & Security
- JWT token-based auth
- Simple demo credentials (admin/admin)
- CORS support
- Extensible auth system

## 🔧 Installation & Setup

### Prerequisites
- Node.js 12+
- Optional: Docker for container support

### Installation

```bash
# Clone/setup project
cd /home/kali/Desktop

# Install dependencies
npm install

# Install system service (optional)
sudo npm run install-service
```

### Configuration

Edit `~/.process-manager/config.yaml`:

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

api:
  port: 3000
  host: localhost
  jwtSecret: your-secret-key-here

environment:
  NODE_ENV: production
```

## 🚀 Running the Platform

### Start Development

```bash
# Start the complete platform
npm run platform

# Open dashboard in browser
# http://localhost:3000/dashboard.html
# Login with admin/admin
```

### Start as System Service

```bash
# Install as systemd service
sudo npm run install-service

# Start service
sudo systemctl start process-manager

# Enable on boot
sudo systemctl enable process-manager

# View logs
sudo journalctl -u process-manager -f
```

## 📡 API Endpoints

### Authentication
```
POST   /api/auth/login           - Login and get JWT token
GET    /api/auth/verify          - Verify token
POST   /api/auth/logout          - Logout
```

### Game Servers
```
POST   /api/servers              - Create server
GET    /api/servers              - List all servers
GET    /api/servers/:name        - Get server status
POST   /api/servers/:name/start  - Start server
POST   /api/servers/:name/stop   - Stop server
POST   /api/servers/:name/restart- Restart server
DELETE /api/servers/:name        - Delete server
GET    /api/servers/:name/logs   - Get logs
POST   /api/servers/:name/limits - Set resource limits
```

### Health
```
GET    /health                   - Health check
```

## 🔌 WebSocket Events

Connect to `ws://localhost:3000`:

```javascript
// Receive events
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  // message.type: 'server-created', 'server-stopped', 'server-restarted'
  // message.data: event details
};

// Subscribe to logs
ws.send(JSON.stringify({
  action: 'subscribe-logs',
  data: { processName: 'my-server' }
}));

// Stream logs come as
{
  type: 'log',
  channel: 'my-server',
  data: { timestamp, level, message }
}
```

## 📊 Example Usage

### Create Minecraft Server

```bash
# Via Dashboard
1. Go to http://localhost:3000/dashboard.html
2. Enter name: "survival-world"
3. Select type: "minecraft"
4. Click "Create Server"
5. Monitor logs in real-time

# Via API
curl -X POST http://localhost:3000/api/servers \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "survival-world",
    "type": "minecraft",
    "options": {
      "memory": "2g",
      "env": { "DIFFICULTY": "hard" }
    }
  }'
```

### Monitor Server

```javascript
// Get status
const response = await fetch('/api/servers/survival-world', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const status = await response.json();
console.log(status.server);

// Get logs
const logsResponse = await fetch('/api/servers/survival-world/logs?limit=100', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const logs = await logsResponse.json();
logs.logs.forEach(log => console.log(log));
```

### Set Resource Limits

```bash
curl -X POST http://localhost:3000/api/servers/survival-world/limits \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "memory": "1g",
    "cpus": 2
  }'
```

## 🎮 Predefined Server Types

### Minecraft
```yaml
docker: itzg/minecraft-server:latest
ports: [25565:25565]
memory: 1g
cpus: 2
env:
  EULA: 'TRUE'
  MEMORY: '1G'
```

### CS:GO
```yaml
docker: joedwards32/cs-server:latest
ports: [27015:27015, 27015:27015/udp]
memory: 2g
cpus: 2
```

### Generic (Node.js)
```yaml
docker: node:18-alpine
ports: [8000:8000]
memory: 512m
cpus: 1
```

## 🔐 Security Notes

⚠️ **Important for Production:**

1. Change the default credentials in `login.html`
2. Set strong JWT secret in config
3. Use HTTPS/WSS in production
4. Implement proper database authentication
5. Add rate limiting
6. Validate all inputs
7. Use reverse proxy (nginx)
8. Enable firewall rules

## 🛠️ Development

### Run Examples

```bash
npm run example              # Basic examples
npm run infrastructure       # Infrastructure features
npm run platform-demo       # Platform demonstration
npm test                    # Run tests
```

### Logs Location

- Platform logs: `~/.process-manager/logs/`
- systemd logs: `journalctl -u process-manager -f`
- System logs: `/var/log/syslog`

## 📈 Next Steps

### Extend the Platform

1. **Database Integration**
   - Store server configs
   - User management
   - Permission system

2. **Multi-tenancy**
   - Per-user server limits
   - Billing integration
   - Team management

3. **Monitoring**
   - Prometheus metrics
   - Alerting system
   - Performance dashboards

4. **Backup & Restore**
   - Server state snapshots
   - World backups
   - Automated restoration

5. **Advanced Features**
   - Auto-scaling based on player count
   - Load balancing
   - Disaster recovery
   - Blue-green deployments

## 🐛 Troubleshooting

### Docker not available
The platform falls back to native process mode automatically.

### Ports in use
Change API port in config or stop other services.

### WebSocket connection fails
Check CORS settings and firewall rules.

### High memory usage
Implement log rotation or increase `maxBufferSize`.

## 📝 License

MIT

## 🤝 Support

For issues or questions, refer to the examples or source code.

---

**You now have a complete game server platform!** 🎮🚀
