#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const ProcessManager = require('../src/index.js');
const PersistenceManager = require('../src/PersistenceManager.js');
const ConfigManager = require('../src/ConfigManager.js');

/**
 * Daemon Service - Runs as a background service
 */  
class DaemonService {
  constructor(configPath = null) {
    this.configManager = new ConfigManager(configPath);
    this.config = this.configManager.load();
    
    this.persistenceManager = new PersistenceManager(
      this.config.persistence.dataDirectory
    );
    
    this.pm = new ProcessManager();
    this.server = null;
    this.saveInterval = null;
    this.isShuttingDown = false;

    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.pm.on('start', ({ name, pid }) => {
      this.log('start', `Process started: ${name} (PID: ${pid})`);
      this.scheduleSave();
    });

    this.pm.on('stop', ({ name }) => {
      this.log('stop', `Process stopped: ${name}`);
      this.scheduleSave();
    });

    this.pm.on('restart', ({ name, restarts }) => {
      this.log('restart', `Process restarted: ${name} (${restarts} times)`);
      this.scheduleSave();
    });

    this.pm.on('error', ({ name, error }) => {
      this.log('error', `Error in ${name}: ${error.message}`);
    });

    this.pm.on('exit', ({ name, code }) => {
      this.log('exit', `Process exited: ${name} (code: ${code})`);
      this.scheduleSave();
    });
  }

  /**
   * Initialize daemon
   */
  initialize() {
    this.log('info', 'Initializing daemon service...');

    // Validate config
    const validation = this.configManager.validate();
    if (!validation.valid) {
      this.log('error', 'Config validation failed:');
      validation.errors.forEach(err => this.log('error', `  - ${err}`));
      return false;
    }

    this.log('info', `Using data directory: ${this.persistenceManager.getDataDirectory()}`);

    // Load persisted processes
    this.recoverProcesses();

    // Setup periodic saves
    if (this.config.persistence.enabled) {
      this.setupPeriodicSave();
    }

    return true;
  }

  /**
   * Recover processes from persisted state
   */
  recoverProcesses() {
    const state = this.persistenceManager.loadState();
    
    if (!state.processes || state.processes.length === 0) {
      this.log('info', 'No persisted processes to recover');
      return;
    }

    this.log('info', `Recovering ${state.processes.length} processes...`);

    state.processes.forEach(proc => {
      try {
        if (proc.autoStart) {
          this.log('info', `Recovering process: ${proc.name}`);
          const options = {
            name: proc.name,
            cwd: proc.cwd || process.cwd(),
            env: proc.env || process.env
          };

          this.pm.start(proc.command, proc.args || [], options);
        }
      } catch (error) {
        this.log('error', `Failed to recover process ${proc.name}: ${error.message}`);
      }
    });
  }

  /**
   * Setup periodic state saving
   */
  setupPeriodicSave() {
    this.saveInterval = setInterval(() => {
      this.saveState();
    }, this.config.persistence.saveInterval || 10000);
  }

  /**
   * Schedule state save (debounced)
   */
  scheduleSave() {
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveState();
        this.saveTimer = null;
      }, 1000);
    }
  }

  /**
   * Save current state
   */
  saveState() {
    if (this.config.persistence.enabled) {
      const processes = new Map();
      this.pm.getAllProcesses().forEach(proc => {
        processes.set(proc.name, proc);
      });
      this.persistenceManager.saveState(processes);
    }
  }

  /**
   * Start the daemon server
   */
  startServer() {
    return new Promise((resolve, reject) => {
      const socketPath = this.persistenceManager.getSocketPath();

      // Remove old socket file if exists
      if (fs.existsSync(socketPath)) {
        try {
          fs.unlinkSync(socketPath);
        } catch (e) {
          // Ignore
        }
      }

      this.server = net.createServer((socket) => {
        this.handleClient(socket);
      });

      this.server.listen(socketPath, () => {
        this.log('info', `Daemon listening on socket: ${socketPath}`);
        resolve();
      });

      this.server.on('error', (error) => {
        this.log('error', `Server error: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * Handle client connection
   */
  handleClient(socket) {
    let data = '';

    socket.on('data', (chunk) => {
      data += chunk.toString();

      try {
        const command = JSON.parse(data);
        const response = this.processCommand(command);
        socket.write(JSON.stringify(response) + '\n');
        socket.end();
      } catch (error) {
        // Keep reading if JSON is incomplete
        if (error.message.includes('JSON')) {
          // Incomplete JSON, wait for more data
        } else {
          socket.write(JSON.stringify({ error: error.message }) + '\n');
          socket.end();
        }
      }
    });

    socket.on('error', (error) => {
      this.log('error', `Socket error: ${error.message}`);
    });
  }

  /**
   * Process command from client
   */
  processCommand(command) {
    const { action, name, args, options } = command;

    try {
      switch (action) {
        case 'start': {
          if (!name || !args) throw new Error('Missing required fields: name, args');
          const startInfo = this.pm.start(args[0], args.slice(1), { name, ...options });
          return { success: true, data: startInfo };
        }

        case 'stop':
          if (!name) throw new Error('Missing required field: name');
          return { success: true, message: `Stopping ${name}...` };

        case 'restart':
          if (!name) throw new Error('Missing required field: name');
          return { success: true, message: `Restarting ${name}...` };

        case 'list':
          return { success: true, data: this.pm.getAllProcesses() };

        case 'info': {
          if (!name) throw new Error('Missing required field: name');
          const info = this.pm.getProcessInfo(name);
          if (!info) throw new Error(`Process not found: ${name}`);
          return { success: true, data: info };
        }

        case 'status': {
          const stats = this.persistenceManager.getStats();
          return { success: true, data: { ...stats, processes: this.pm.getAllProcesses() } };
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Start daemon service
   */
  async start() {
    try {
      if (!this.initialize()) {
        throw new Error('Failed to initialize daemon');
      }

      await this.startServer();

      // Save PID
      this.persistenceManager.savePID(process.pid);
      this.log('info', `Daemon started with PID: ${process.pid}`);

      // Setup signal handlers
      this.setupSignalHandlers();
    } catch (error) {
      this.log('error', `Failed to start daemon: ${error.message}`);
      throw error;
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers() {
    const shutdown = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      this.log('info', 'Received shutdown signal...');
      
      if (this.saveInterval) clearInterval(this.saveInterval);
      if (this.saveTimer) clearTimeout(this.saveTimer);

      // Save final state
      this.saveState();

      // Stop all processes
      this.log('info', 'Stopping all processes...');
      await this.pm.stopAll();

      // Close server
      if (this.server) {
        this.server.close();
      }

      // Clear PID
      this.persistenceManager.clearPID();

      this.log('info', 'Daemon shut down complete');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  /**
   * Log message
   */
  log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }

  /**
   * Get status
   */
  getStatus() {
    return this.persistenceManager.getStats();
  }
}

// Run daemon if executed directly
if (require.main === module) {
  const configPath = process.argv[2];
  const daemon = new DaemonService(configPath);

  daemon.start().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = DaemonService;
