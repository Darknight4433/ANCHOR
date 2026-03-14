const EventEmitter = require('events');
const DockerAdapter = require('./DockerAdapter.js');
const Validator = require('./Validator.js');
const GameServerTemplates = require('./GameServerTemplates.js');

/**
 * GameServerManager - Specialized manager for game servers
 * Supports both Docker containers and native processes
 */
class GameServerManager extends EventEmitter {
  constructor(processManager, dockerAdapter = null) {
    super();
    this.pm = processManager;
    this.docker = dockerAdapter || new DockerAdapter();
    this.servers = new Map();
    this.logStreams = new Map();
    
    // Load built-in game server templates
    this.serverTypes = new Map();
    const availableGames = GameServerTemplates.getAvailableGames();
    availableGames.forEach(game => {
      const template = GameServerTemplates.getTemplate(game);
      if (template) {
        this.defineServerType(game, {
          docker: template.image,
          ports: template.ports,
          env: template.env,
          memory: template.resources.memory,
          cpus: template.resources.cpus,
          volumes: template.volumes
        });
      }
    });
  }

  /**
   * Define a game server template
   */
  defineServerType(type, config) {
    try {
      Validator.validateServerType(type);
      if (!config || typeof config !== 'object') {
        throw new Error('Server type config must be a non-null object');
      }
    } catch (error) {
      throw new Error(`Invalid server type: ${error.message}`);
    }
    if (!this.serverTypes) this.serverTypes = new Map();
    this.serverTypes.set(type, config);
    return this;
  }

  /**
   * Create and start a game server
   * @param {string} name - Server name
   * @param {string} serverType - Server type (minecraft, csgo, etc)
   * @param {object} options - Server-specific options
   */
  async createServer(name, serverType, options = {}) {
    try {
      // Validate inputs
      Validator.validateServerName(name);
      Validator.validateServerType(serverType);

      const template = this.serverTypes?.get(serverType);
      if (!template) {
        throw new Error(`Unknown server type: ${serverType}`);
      }

      // Validate options if provided
      if (options.memory) Validator.validateMemoryLimit(options.memory);
      if (options.cpus) Validator.validateCpuLimit(options.cpus);

      const serverConfig = {
        name,
        type: serverType,
        template,
        ...options,
        createdAt: new Date().toISOString(),
        status: 'starting',
        uptime: 0,
        logs: [],
        stats: {}
      };

      // Use Docker if available and configured
      if (template.docker && await this.docker.isDockerAvailable()) {
        const containerOptions = {
          name,
          ports: template.ports,
          volumes: template.volumes,
          env: {
            ...template.env,
            ...options.env
          },
          memory: options.memory || template.memory,
          cpus: options.cpus || template.cpus
        };

        const containerInfo = await this.docker.startContainer(
          template.docker,
          containerOptions
        );

        serverConfig.runtime = 'docker';
        serverConfig.containerId = containerInfo.id;
        serverConfig.pid = containerInfo.pid;
      } else {
        // Use native process
        const processOptions = {
          name,
          cwd: options.cwd || template.cwd,
          env: { ...process.env, ...template.env, ...options.env }
        };

        const cmd = template.command || 'node';
        const args = template.args || [];

        const processInfo = this.pm.start(cmd, args, processOptions);

        serverConfig.runtime = 'process';
        serverConfig.pid = processInfo.pid;
      }

      serverConfig.status = 'running';
      this.servers.set(name, serverConfig);

      this.emit('server-created', { name, ...serverConfig });
      return serverConfig;
    } catch (error) {
      this.emit('error', { error, action: 'create', name });
      throw error;
    }
  }

  /**
   * Stop a game server
   */
  async stopServer(name, force = false) {
    try {
      const server = this.servers.get(name);
      if (!server) throw new Error(`Server not found: ${name}`);

      if (server.runtime === 'docker') {
        await this.docker.stopContainer(server.containerId, force ? 0 : 30);
      } else {
        await this.pm.stop(name);
      }

      server.status = 'stopped';
      this.emit('server-stopped', { name });
      return true;
    } catch (error) {
      this.emit('error', { error, action: 'stop', name });
      throw error;
    }
  }

  /**
   * Restart a game server
   */
  async restartServer(name) {
    try {
      const server = this.servers.get(name);
      if (!server) throw new Error(`Server not found: ${name}`);

      if (server.runtime === 'docker') {
        await this.docker.restartContainer(server.containerId);
      } else {
        await this.pm.restart(name);
      }

      server.status = 'running';
      this.emit('server-restarted', { name });
      return true;
    } catch (error) {
      this.emit('error', { error, action: 'restart', name });
      throw error;
    }
  }

  /**
   * Get server status
   */
  async getServerStatus(name) {
    try {
      const server = this.servers.get(name);
      if (!server) return null;

      let stats = {};
      if (server.runtime === 'docker' && server.containerId) {
        stats = await this.docker.getContainerStats(server.containerId);
      }

      const uptime = server.runtime === 'docker'
        ? this.docker.getContainerUptime(server.containerId)
        : (server.pid ? Date.now() - (server.createdAt ? new Date(server.createdAt).getTime() : Date.now()) : 0);

      return {
        name,
        type: server.type,
        status: server.status,
        runtime: server.runtime,
        pid: server.pid,
        uptime,
        stats,
        logs: server.logs.slice(-10) // Last 10 logs
      };
    } catch (error) {
      return { name, status: 'error', error: error.message };
    }
  }

  /**
   * Stream server logs
   */
  async streamLogs(name, callback) {
    try {
      const server = this.servers.get(name);
      if (!server) throw new Error(`Server not found: ${name}`);

      if (server.runtime === 'docker' && server.containerId) {
        const stream = await this.docker.getContainerLogs(server.containerId, { follow: true });
        
        stream.stdout.on('data', (data) => {
          const logLine = data.toString().trim();
          if (logLine) {
            server.logs.push({ timestamp: Date.now(), message: logLine });
            callback(null, logLine);
          }
        });

        stream.stderr.on('data', (data) => {
          const logLine = data.toString().trim();
          if (logLine) {
            server.logs.push({ timestamp: Date.now(), message: logLine, level: 'error' });
            callback(null, logLine);
          }
        });

        stream.on('error', (error) => callback(error));
        stream.on('end', () => callback(new Error('Stream ended')));

        this.logStreams.set(name, stream);
      } else if (server.runtime === 'process') {
        // For processes, stream from PM
        const processInfo = this.pm.getProcessInfo(name);
        if (processInfo && processInfo.process) {
          processInfo.process.stdout?.on('data', (data) => {
            const logLine = data.toString().trim();
            if (logLine) {
              server.logs.push({ timestamp: Date.now(), message: logLine });
              callback(null, logLine);
            }
          });

          processInfo.process.stderr?.on('data', (data) => {
            const logLine = data.toString().trim();
            if (logLine) {
              server.logs.push({ timestamp: Date.now(), message: logLine, level: 'error' });
              callback(null, logLine);
            }
          });
        }
      }
    } catch (error) {
      callback(error);
    }
  }

  /**
   * Stop log streaming
   */
  stopStreamingLogs(name) {
    const stream = this.logStreams.get(name);
    if (stream) {
      stream.kill();
      this.logStreams.delete(name);
    }
  }

  /**
   * Get server logs
   */
  async getLogs(name, limit = 50) {
    const server = this.servers.get(name);
    if (!server) throw new Error(`Server not found: ${name}`);

    if (server.runtime === 'docker' && server.containerId) {
      const logs = await this.docker.getContainerLogs(server.containerId, { tail: limit });
      return logs;
    } else {
      return server.logs.slice(-limit);
    }
  }

  /**
   * Enforce resource limits
   */
  async setResourceLimits(name, limits) {
    try {
      const server = this.servers.get(name);
      if (!server) throw new Error(`Server not found: ${name}`);

      const { memory, cpus } = limits;

      if (server.runtime === 'docker' && server.containerId) {
        // For Docker, we'd need to update container limits
        // This typically requires stopping and restarting with new limits
        if (memory || cpus) {
          throw new Error('Docker limit updates require container restart');
        }
      }

      if (memory) server.limits = server.limits || {};
      if (memory) server.limits.memory = memory;
      if (cpus) server.limits.cpus = cpus;

      this.emit('limits-updated', { name, limits });
      return true;
    } catch (error) {
      this.emit('error', { error, action: 'set-limits', name });
      throw error;
    }
  }

  /**
   * Get all servers
   */
  getAllServers() {
    return Array.from(this.servers.entries()).map(([name, config]) => ({
      name,
      ...config
    }));
  }

  /**
   * List servers with status
   */
  async listServersWithStatus() {
    const statuses = [];
    for (const name of this.servers.keys()) {
      const status = await this.getServerStatus(name);
      statuses.push(status);
    }
    return statuses;
  }

  /**
   * Delete a server
   */
  async deleteServer(name, force = false) {
    try {
      const server = this.servers.get(name);
      if (!server) throw new Error(`Server not found: ${name}`);

      if (server.status === 'running') {
        await this.stopServer(name, force);
      }

      if (server.runtime === 'docker' && server.containerId) {
        await this.docker.removeContainer(server.containerId, force);
      } else {
        this.pm.remove(name);
      }

      this.stopStreamingLogs(name);
      this.servers.delete(name);
      this.emit('server-deleted', { name });
      return true;
    } catch (error) {
      this.emit('error', { error, action: 'delete', name });
      throw error;
    }
  }

  /**
   * Get server statistics (CPU, memory usage, etc.)
   */
  async getServerStats(name) {
    try {
      const server = this.servers.get(name);
      if (!server) throw new Error(`Server not found: ${name}`);

      if (server.runtime === 'docker' && server.containerId) {
        const stats = await this.docker.getContainerStats(server.containerId);
        return {
          name,
          runtime: 'docker',
          containerId: server.containerId,
          ...stats
        };
      } else if (server.pid) {
        // For process runtime, return basic info
        return {
          name,
          runtime: 'process',
          pid: server.pid,
          status: server.status,
          uptime: server.uptime || 0
        };
      }

      return { name, status: server.status };
    } catch (error) {
      throw new Error(`Failed to get stats for ${name}: ${error.message}`);
    }
  }
}

module.exports = GameServerManager;
