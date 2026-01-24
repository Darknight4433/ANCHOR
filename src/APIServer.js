const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const EventEmitter = require('events');
const Validator = require('./Validator.js');

/**
 * APIServer - REST API for process and game server management
 * Includes WebSocket support for real-time updates
 */
class APIServer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      port: config.port || 3000,
      host: config.host || 'localhost',
      jwtSecret: config.jwtSecret || 'change-me-in-production',
      corsOrigin: config.corsOrigin || '*',
      ...config
    };

    // Validate configuration
    try {
      Validator.validatePort(this.config.port);
    } catch (error) {
      console.warn(`Invalid port configuration: ${error.message}, using default 3000`);
      this.config.port = 3000;
    }

    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    this.wsClients = new Map();

    this.setupMiddleware();
    this.setupWebSocket();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', this.config.corsOrigin);
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // Auth middleware
    this.app.use('/api', (req, res, next) => {
      if (req.path === '/auth/login' || req.path === '/health') {
        return next();
      }

      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      try {
        const decoded = jwt.verify(token, this.config.jwtSecret);
        req.user = decoded;
        next();
      } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
      }
    });
  }

  /**
   * Setup WebSocket server
   */
  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      const clientId = Math.random().toString(36).slice(2);
      this.wsClients.set(clientId, ws);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(clientId, message);
        } catch (error) {
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        this.wsClients.delete(clientId);
      });

      ws.send(JSON.stringify({ type: 'connected', clientId }));
    });
  }

  /**
   * Handle WebSocket messages
   */
  handleWebSocketMessage(clientId, message) {
    const ws = this.wsClients.get(clientId);
    if (!ws) return;

    const { action, data } = message;

    switch (action) {
      case 'subscribe-logs':
        ws.send(JSON.stringify({ type: 'subscribed', channel: data.processName }));
        break;
      case 'unsubscribe-logs':
        ws.send(JSON.stringify({ type: 'unsubscribed', channel: data.processName }));
        break;
      default:
        ws.send(JSON.stringify({ error: 'Unknown action', action }));
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcastToClients(message) {
    this.wsClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  /**
   * Broadcast to specific channel
   */
  broadcastToChannel(channel, message) {
    this.wsClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ channel, ...message }));
      }
    });
  }

  /**
   * Register routes for game servers
   */
  registerGameServerRoutes(gameServerManager) {
    const api = express.Router();

    // Create server
    api.post('/servers', async (req, res) => {
      try {
        const { name, type, options } = req.body;
        if (!name || !type) {
          return res.status(400).json({ error: 'Missing required fields: name, type' });
        }

        // Validate inputs
        try {
          Validator.validateServerName(name);
          Validator.validateServerType(type);
          if (options && typeof options !== 'object') {
            throw new Error('Options must be an object');
          }
        } catch (validationError) {
          return res.status(400).json({ error: `Validation error: ${validationError.message}` });
        }

        const server = await gameServerManager.createServer(name, type, options);
        this.broadcastToClients({ type: 'server-created', server });
        res.json({ success: true, server });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // List servers
    api.get('/servers', async (req, res) => {
      try {
        const servers = await gameServerManager.listServersWithStatus();
        res.json({ success: true, servers });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get server status
    api.get('/servers/:name', async (req, res) => {
      try {
        const status = await gameServerManager.getServerStatus(req.params.name);
        if (!status) {
          return res.status(404).json({ error: 'Server not found' });
        }
        res.json({ success: true, status });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Start server
    api.post('/servers/:name/start', async (req, res) => {
      try {
        await gameServerManager.createServer(req.params.name, req.body.type, req.body.options);
        res.json({ success: true, message: 'Server started' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Stop server
    api.post('/servers/:name/stop', async (req, res) => {
      try {
        const { force } = req.body;
        await gameServerManager.stopServer(req.params.name, force);
        this.broadcastToClients({ type: 'server-stopped', name: req.params.name });
        res.json({ success: true, message: 'Server stopped' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Restart server
    api.post('/servers/:name/restart', async (req, res) => {
      try {
        await gameServerManager.restartServer(req.params.name);
        this.broadcastToClients({ type: 'server-restarted', name: req.params.name });
        res.json({ success: true, message: 'Server restarted' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Delete server
    api.delete('/servers/:name', async (req, res) => {
      try {
        const { force } = req.query;
        await gameServerManager.deleteServer(req.params.name, force === 'true');
        this.broadcastToClients({ type: 'server-deleted', name: req.params.name });
        res.json({ success: true, message: 'Server deleted' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Get logs
    api.get('/servers/:name/logs', async (req, res) => {
      try {
        const { limit } = req.query;
        const logs = await gameServerManager.getLogs(req.params.name, parseInt(limit) || 50);
        res.json({ success: true, logs });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Set resource limits
    api.post('/servers/:name/limits', async (req, res) => {
      try {
        const { memory, cpus } = req.body;
        await gameServerManager.setResourceLimits(req.params.name, { memory, cpus });
        res.json({ success: true, message: 'Limits updated' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.use('/api', api);
  }

  /**
   * Register authentication routes
   */
  registerAuthRoutes() {
    const api = express.Router();

    api.post('/auth/login', (req, res) => {
      const { username, password } = req.body;

      // Simple auth - in production, validate against database
      if (username === 'admin' && password === 'admin') {
        const token = jwt.sign(
          { username, role: 'admin' },
          this.config.jwtSecret,
          { expiresIn: '24h' }
        );
        return res.json({ success: true, token });
      }

      res.status(401).json({ error: 'Invalid credentials' });
    });

    api.get('/auth/verify', (req, res) => {
      res.json({ success: true, user: req.user });
    });

    api.post('/auth/logout', (req, res) => {
      res.json({ success: true, message: 'Logged out' });
    });

    this.app.use('/api', api);
  }

  /**
   * Register health routes
   */
  registerHealthRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        wsClients: this.wsClients.size
      });
    });
  }

  /**
   * Start the API server
   */
  start() {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => {
        this.emit('started', { port: this.config.port, host: this.config.host });
        console.log(`🚀 API Server running on http://${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the API server
   */
  stop() {
    return new Promise((resolve) => {
      this.wss.close();
      this.server.close(() => {
        this.emit('stopped');
        resolve();
      });
    });
  }
}

module.exports = APIServer;
