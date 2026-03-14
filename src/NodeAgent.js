const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const EventEmitter = require('events');
const logger = require('./Logger.js');
const CargoManager = require('./CargoManager.js');

/**
 * NodeAgent - Runs on each cluster node to manage local containers
 * Communicates with central ANCHOR controller
 */
class NodeAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      port: config.port || 3001,
      host: config.host || '0.0.0.0',
      controllerUrl: config.controllerUrl || 'http://localhost:3000',
      nodeId: config.nodeId || `node-${os.hostname()}-${Date.now()}`,
      region: config.region || 'default',
      ...config
    };

    this.cargoManager = new CargoManager();
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    this.controllerWs = null;
    this.isRegistered = false;

    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Get node capacity and status
   */
  getNodeInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpus = os.cpus().length;
    const loadAvg = os.loadavg();

    return {
      nodeId: this.config.nodeId,
      hostname: os.hostname(),
      region: this.config.region,
      capacity: {
        memory: {
          total: Math.round(totalMem / 1024 / 1024), // MB
          free: Math.round(freeMem / 1024 / 1024),
          used: Math.round((totalMem - freeMem) / 1024 / 1024)
        },
        cpu: {
          cores: cpus,
          load: loadAvg[0] // 1min average
        }
      },
      containers: this.cargoManager.getAllCargos().length,
      status: 'online',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Setup HTTP routes
   */
  setupRoutes() {
    this.app.use(express.json());

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        nodeId: this.config.nodeId,
        uptime: process.uptime()
      });
    });

    // Node info
    this.app.get('/info', (req, res) => {
      res.json(this.getNodeInfo());
    });

    // Container management (called by controller)
    this.app.post('/containers', async (req, res) => {
      try {
        const { id, blueprint, options } = req.body;
        const cargo = await this.cargoManager.createCargo(id, blueprint, options);
        res.json({ success: true, cargo });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/containers/:id/start', async (req, res) => {
      try {
        const cargo = await this.cargoManager.startCargo(req.params.id);
        res.json({ success: true, cargo });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/containers/:id/stop', async (req, res) => {
      try {
        const cargo = await this.cargoManager.stopCargo(req.params.id);
        res.json({ success: true, cargo });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/containers/:id', async (req, res) => {
      try {
        const result = await this.cargoManager.removeCargo(req.params.id);
        res.json({ success: true, result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  /**
   * Setup WebSocket connection to controller
   */
  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      logger.info(`NodeAgent: Controller connected to ${this.config.nodeId}`);

      this.controllerWs = ws;

      // Send registration
      this.sendToController('register', this.getNodeInfo());

      // Handle messages from controller
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleControllerMessage(message);
        } catch (error) {
          logger.error(`NodeAgent: Invalid message from controller: ${error.message}`);
        }
      });

      ws.on('close', () => {
        logger.warn(`NodeAgent: Controller connection lost for ${this.config.nodeId}`);
        this.controllerWs = null;
        this.isRegistered = false;
        // Auto-reconnect logic could go here
      });

      // Send periodic heartbeats
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          this.sendToController('heartbeat', this.getNodeInfo());
        } else {
          clearInterval(heartbeat);
        }
      }, 30000);
    });
  }

  /**
   * Handle messages from controller
   */
  handleControllerMessage(message) {
    const { type, data } = message;

    switch (type) {
      case 'registered':
        this.isRegistered = true;
        logger.info(`NodeAgent: ${this.config.nodeId} registered with controller`);
        break;

      case 'create-container':
        this.handleCreateContainer(data);
        break;

      case 'start-container':
        this.handleStartContainer(data);
        break;

      case 'stop-container':
        this.handleStopContainer(data);
        break;

      case 'remove-container':
        this.handleRemoveContainer(data);
        break;

      default:
        logger.warn(`NodeAgent: Unknown message type: ${type}`);
    }
  }

  /**
   * Send message to controller
   */
  sendToController(type, data) {
    if (this.controllerWs && this.controllerWs.readyState === WebSocket.OPEN) {
      this.controllerWs.send(JSON.stringify({ type, data, nodeId: this.config.nodeId }));
    }
  }

  /**
   * Handle container creation
   */
  async handleCreateContainer(data) {
    try {
      const { id, blueprint, options } = data;
      const cargo = await this.cargoManager.createCargo(id, blueprint, options);
      this.sendToController('container-created', { id, cargo });
    } catch (error) {
      this.sendToController('container-error', { id: data.id, error: error.message });
    }
  }

  /**
   * Handle container start
   */
  async handleStartContainer(data) {
    try {
      const cargo = await this.cargoManager.startCargo(data.id);
      this.sendToController('container-started', { id: data.id, cargo });
    } catch (error) {
      this.sendToController('container-error', { id: data.id, error: error.message });
    }
  }

  /**
   * Handle container stop
   */
  async handleStopContainer(data) {
    try {
      const cargo = await this.cargoManager.stopCargo(data.id);
      this.sendToController('container-stopped', { id: data.id, cargo });
    } catch (error) {
      this.sendToController('container-error', { id: data.id, error: error.message });
    }
  }

  /**
   * Handle container removal
   */
  async handleRemoveContainer(data) {
    try {
      const result = await this.cargoManager.removeCargo(data.id);
      this.sendToController('container-removed', { id: data.id, result });
    } catch (error) {
      this.sendToController('container-error', { id: data.id, error: error.message });
    }
  }

  /**
   * Start the node agent
   */
  async start() {
    await this.cargoManager.initialize();

    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => {
        logger.info(`🚀 NodeAgent ${this.config.nodeId} running on ${this.config.host}:${this.config.port}`);
        logger.info(`📡 Connecting to controller at ${this.config.controllerUrl}`);

        // Connect to controller WebSocket
        this.connectToController();

        resolve();
      });
    });
  }

  /**
   * Connect to central controller
   */
  connectToController() {
    try {
      const controllerWsUrl = this.config.controllerUrl.replace('http', 'ws') + '/nodes';
      const ws = new WebSocket(controllerWsUrl);

      ws.on('open', () => {
        logger.info(`NodeAgent: Connected to controller`);
        this.controllerWs = ws;
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleControllerMessage(message);
        } catch (error) {
          logger.error(`NodeAgent: Invalid message from controller: ${error.message}`);
        }
      });

      ws.on('close', () => {
        logger.warn(`NodeAgent: Controller connection closed`);
        this.controllerWs = null;
        this.isRegistered = false;
        // Reconnect after delay
        setTimeout(() => this.connectToController(), 5000);
      });

      ws.on('error', (error) => {
        logger.error(`NodeAgent: Controller connection error: ${error.message}`);
      });

    } catch (error) {
      logger.error(`NodeAgent: Failed to connect to controller: ${error.message}`);
    }
  }

  /**
   * Stop the node agent
   */
  async stop() {
    if (this.controllerWs) {
      this.controllerWs.close();
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info(`NodeAgent ${this.config.nodeId} stopped`);
        resolve();
      });
    });
  }
}

module.exports = NodeAgent;