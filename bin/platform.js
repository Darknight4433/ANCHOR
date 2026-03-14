#!/usr/bin/env node

const ProcessManager = require('../src/index.js');
const GameServerManager = require('../src/GameServerManager.js');
const DockerAdapter = require('../src/DockerAdapter.js');
const LogStreamService = require('../src/LogStreamService.js');
const APIServer = require('../src/APIServer.js');
const ConfigManager = require('../src/ConfigManager.js');
const path = require('path');
const express = require('express');

/**
 * Game Server Platform - Complete infrastructure platform
 * Combines process management, Docker, logging, and web API
 */
class GameServerPlatform {
  constructor(configPath = null) {
    this.configManager = new ConfigManager(configPath);
    this.config = this.configManager.load();

    // Core services
    this.pm = new ProcessManager();
    this.docker = new DockerAdapter();
    this.logs = new LogStreamService();
    this.gameServers = new GameServerManager(this.pm, this.docker);
    this.api = new APIServer({
      port: this.config.api?.port || 3000,
      host: this.config.api?.host || 'localhost',
      jwtSecret: this.config.api?.jwtSecret || 'change-me-in-production'
    });

    this.setupServerTypes();
    this.setupEventListeners();
  }

  /**
   * Setup predefined server types
   */
  setupServerTypes() {
    // Minecraft server
    this.gameServers.defineServerType('minecraft', {
      docker: 'itzg/minecraft-server:latest',
      ports: [{ host: '25565', container: '25565' }],
      volumes: [{ host: '/tmp/minecraft', container: '/data' }],
      env: {
        EULA: 'TRUE',
        MEMORY: '1G'
      },
      memory: '1g',
      cpus: '2'
    });

    // Generic game server
    this.gameServers.defineServerType('generic', {
      docker: 'node:18-alpine',
      ports: [{ host: '8000', container: '8000' }],
      volumes: [],
      env: {},
      memory: '512m',
      cpus: '1'
    });

    // CS:GO server (example)
    this.gameServers.defineServerType('csgo', {
      docker: 'joedwards32/cs-server:latest',
      ports: [
        { host: '27015', container: '27015' },
        { host: '27015', container: '27015/udp' }
      ],
      volumes: [],
      env: {
        CSGO_HOSTNAME: 'GameServer'
      },
      memory: '2g',
      cpus: '2'
    });
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Game server events
    this.gameServers.on('server-created', ({ name }) => {
      this.logs.write('platform', `Server created: ${name}`, 'info', { server: name });
      this.api.broadcastToClients({ type: 'server-created', server: name });
    });

    this.gameServers.on('server-stopped', ({ name }) => {
      this.logs.write('platform', `Server stopped: ${name}`, 'info', { server: name });
      this.api.broadcastToClients({ type: 'server-stopped', server: name });
    });

    this.gameServers.on('server-restarted', ({ name }) => {
      this.logs.write('platform', `Server restarted: ${name}`, 'info', { server: name });
      this.api.broadcastToClients({ type: 'server-restarted', server: name });
    });

    this.gameServers.on('error', ({ error, action, name }) => {
      this.logs.write('platform', `Error in ${action} for ${name}: ${error.message}`, 'error');
    });

    // Log service events
    this.logs.on('logs-rotated', ({ rotated }) => {
      console.log(`[PLATFORM] Rotated ${rotated} old log files`);
    });
  }

  /**
   * Setup web server
   */
  setupWebServer() {
    // Serve public files
    const publicDir = path.join(__dirname, '..', 'public');
    this.api.app.use(express.static(publicDir));

    // Redirect root to dashboard
    this.api.app.get('/', (req, res) => {
      res.redirect('/dashboard.html');
    });

    // Setup API routes
    this.api.registerAuthRoutes();
    this.api.registerHealthRoutes();
    this.api.registerGameServerRoutes(this.gameServers);

    // Setup log streaming via WebSocket
    this.logs.on('log', ({ processName, logEntry }) => {
      this.api.broadcastToChannel(processName, {
        type: 'log',
        data: logEntry
      });
    });
  }

  /**
   * Initialize platform
   */
  async initialize() {
    console.log('🚀 Initializing Game Server Platform...\n');

    // Validate config
    const validation = this.configManager.validate();
    if (!validation.valid) {
      console.error('❌ Configuration invalid:');
      validation.errors.forEach(err => console.error(`  - ${err}`));
      throw new Error('Configuration validation failed');
    }

    // Start logging service
    this.logs.startLogging('platform', { persist: true });
    this.logs.write('platform', 'Game Server Platform starting', 'info');

    // Check Docker availability
    const dockerAvailable = await this.docker.isDockerAvailable();
    if (dockerAvailable) {
      console.log('✓ Docker is available');
      this.logs.write('platform', 'Docker is available', 'info');
    } else {
      console.log('⚠ Docker is not available (native process mode only)');
      this.logs.write('platform', 'Docker is not available', 'warn');
    }

    // Setup web server
    this.setupWebServer();

    return true;
  }

  /**
   * Start the platform
   */
  async start() {
    try {
      console.log('Calling initialize...');
      const initialized = await this.initialize();
      console.log('Initialize returned:', initialized);
      
      if (!initialized) {
        throw new Error('Platform initialization failed');
      }

      // Start API server
      console.log('Starting API server...');
      await this.api.start();
      console.log('API server started');

      console.log(`
✅ Platform Started Successfully!

🌐 Dashboard: http://localhost:${this.config.api?.port || 3000}/dashboard.html
📡 API: http://localhost:${this.config.api?.port || 3000}/api
🔌 WebSocket: ws://localhost:${this.config.api?.port || 3000}

Demo Credentials:
  Username: admin
  Password: admin

Features:
  ✓ Game Server Management
  ✓ Docker Container Support
  ✓ Real-time Log Streaming
  ✓ Web Dashboard
  ✓ REST API
  ✓ WebSocket Updates
  ✓ Authentication

Press Ctrl+C to stop
      `);

      this.logs.write('platform', 'Platform started successfully', 'info');

      // Periodic log rotation
      setInterval(() => {
        this.logs.rotateLogs(7); // Keep 7 days of logs
      }, 24 * 60 * 60 * 1000);

      return this;
    } catch (error) {
      console.error('❌ Failed to start platform:', error.message);
      process.exit(1);
    }
  }

  /**
   * Stop the platform
   */
  async stop() {
    console.log('\n🛑 Shutting down platform...');

    // Stop all servers
    const servers = this.gameServers.getAllServers();
    for (const server of servers) {
      if (server.status === 'running') {
        try {
          await this.gameServers.stopServer(server.name);
        } catch (e) {
          // Ignore errors during shutdown
        }
      }
    }

    // Stop log streaming
    this.logs.stopLogging('platform');

    // Stop API
    await this.api.stop();

    this.logs.write('platform', 'Platform stopped', 'info');
    console.log('✓ Platform stopped');
    process.exit(0);
  }

  /**
   * Get platform stats
   */
  getStats() {
    return {
      servers: this.gameServers.getAllServers(),
      logs: this.logs.getStats(),
      uptime: process.uptime()
    };
  }
}

// Main execution
if (require.main === module) {
  const configPath = process.argv[2];
  const platform = new GameServerPlatform(configPath);

  const startPromise = platform.start();
  if (!startPromise) {
    console.error('❌ Platform.start() returned undefined');
    process.exit(1);
  }
  
  startPromise.catch((error) => {
    console.error('Fatal error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => platform.stop());
  process.on('SIGTERM', () => platform.stop());
}

module.exports = GameServerPlatform;
