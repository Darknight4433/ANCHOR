const Docker = require('dockerode');
const EventEmitter = require('events');
require('dotenv').config();

/**
 * DockerRuntime - Primary execution layer for ANCHOR Cargo
 * Uses dockerode API directly, entirely skipping CLI parsing overhead.
 */
class DockerRuntime extends EventEmitter {
  constructor() {
    super();
    // Use DOCKER_HOST from .env if present, else default local socket
    const dockerOpts = process.env.DOCKER_HOST 
      ? { host: process.env.DOCKER_HOST.split(':')[1].replace('//', ''), port: process.env.DOCKER_HOST.split(':')[2] }
      : { socketPath: process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock' };
    
    this.docker = new Docker(dockerOpts);
  }

  async isAvailable() {
    try {
      await this.docker.ping();
      return true;
    } catch (e) {
      return false;
    }
  }

  async create(id, blueprint, options = {}) {
    const { ports = [], env = {}, memory, cpus } = options;
    
    // Prepare exposed ports
    const ExposedPorts = {};
    const PortBindings = {};
    
    ports.forEach(p => {
      const containerPort = typeof p === 'string' ? p : p.container;
      const hostPort = typeof p === 'string' ? p : p.host;
      ExposedPorts[`${containerPort}/tcp`] = {};
      PortBindings[`${containerPort}/tcp`] = [{ HostPort: `${hostPort}` }];
      
      if (containerPort.includes('/udp')) {
        ExposedPorts[containerPort] = {};
        PortBindings[containerPort] = [{ HostPort: `${hostPort}` }];
      }
    });

    // Prepare environment
    const Env = Object.entries(env).map(([k, v]) => `${k}=${v}`);

    // Resource limits
    const HostConfig = { PortBindings };
    if (memory) {
      // Basic translation, assumes MB if numeric
      const memBytes = typeof memory === 'string' 
        ? parseInt(memory.replace(/\D/g, '')) * 1024 * 1024 
        : memory * 1024 * 1024;
      HostConfig.Memory = memBytes;
    }
    if (cpus) {
      HostConfig.NanoCpus = parseInt(cpus * 1e9);
    }

    try {
      // Check if image exists, if not pull it
      const images = await this.docker.listImages();
      const hasImage = images.some(img => img.RepoTags && img.RepoTags.includes(blueprint));
      
      if (!hasImage) {
        this.emit('pulling', { id, blueprint });
        await new Promise((resolve, reject) => {
          this.docker.pull(blueprint, (err, stream) => {
            if (err) return reject(err);
            this.docker.modem.followProgress(stream, onFinished, onProgress);
            function onFinished(err, output) {
              if (err) return reject(err);
              resolve(output);
            }
            function onProgress() {
              // optional: emit progress
            }
          });
        });
      }

      const container = await this.docker.createContainer({
        Image: blueprint,
        name: id,
        Env,
        ExposedPorts,
        HostConfig,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false
      });
      
      return { containerId: container.id, status: 'created' };
    } catch (error) {
      this.emit('error', { id, action: 'create', error: error.message });
      throw error;
    }
  }

  async start(id) {
    try {
      const container = this.docker.getContainer(id);
      await container.start();
      return { status: 'running' };
    } catch (error) {
      this.emit('error', { id, action: 'start', error: error.message });
      throw error;
    }
  }

  async stop(id, timeout = 10) {
    try {
      const container = this.docker.getContainer(id);
      await container.stop({ t: timeout });
      return { status: 'stopped' };
    } catch (error) {
      if (error.statusCode === 304) {
        return { status: 'stopped' }; // Already stopped
      }
      this.emit('error', { id, action: 'stop', error: error.message });
      throw error;
    }
  }

  async restart(id) {
    try {
      const container = this.docker.getContainer(id);
      await container.restart();
      return { status: 'running' };
    } catch (error) {
      this.emit('error', { id, action: 'restart', error: error.message });
      throw error;
    }
  }

  async remove(id, force = false) {
    try {
      const container = this.docker.getContainer(id);
      await container.remove({ force });
      return { status: 'removed' };
    } catch (error) {
      this.emit('error', { id, action: 'remove', error: error.message });
      throw error;
    }
  }

  async getStatus(id) {
    try {
      const container = this.docker.getContainer(id);
      const data = await container.inspect();
      let status = 'unknown';
      if (data.State.Running) status = 'running';
      else if (data.State.Status === 'exited') status = 'stopped';
      else if (data.State.Status === 'created') status = 'created';
      
      return {
        containerId: data.Id,
        status,
        startTime: data.State.StartedAt,
        pid: data.State.Pid,
        exitCode: data.State.ExitCode
      };
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  async attachLogs(id, logCallback) {
    try {
      const container = this.docker.getContainer(id);
      const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: 50
      });

      // Simple demultiplexing
      container.modem.demuxStream(stream, {
        write: (chunk) => logCallback(chunk.toString('utf8'), 'stdout')
      }, {
        write: (chunk) => logCallback(chunk.toString('utf8'), 'stderr')
      });
      
      return stream;
    } catch (error) {
      this.emit('error', { id, action: 'logs', error: error.message });
      throw error;
    }
  }
}

module.exports = DockerRuntime;
