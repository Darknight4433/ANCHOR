const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const EventEmitter = require('events');

const execAsync = promisify(exec);

/**
 * DockerAdapter - Abstraction layer for Docker container management
 * Enables managing Docker containers like processes
 */
class DockerAdapter extends EventEmitter {
  constructor() {
    super();
    this.containers = new Map();
  }

  /**
   * Check if Docker is available
   */
  async isDockerAvailable() {
    try {
      await execAsync('docker --version');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start a Docker container
   * @param {string} image - Docker image name
   * @param {object} options - Container options
   */
  async startContainer(image, options = {}) {
    const {
      name,
      ports = [],
      volumes = [],
      env = {},
      memory = null,
      cpus = null,
      cmd = null,
      detach = true
    } = options;

    try {
      // Build docker command
      let dockerCmd = 'docker run';

      if (detach) dockerCmd += ' -d';
      if (name) dockerCmd += ` --name ${name}`;
      if (memory) dockerCmd += ` --memory ${memory}`;
      if (cpus) dockerCmd += ` --cpus ${cpus}`;

      // Add ports
      ports.forEach(port => {
        if (typeof port === 'string') {
          dockerCmd += ` -p ${port}`;
        } else {
          dockerCmd += ` -p ${port.host}:${port.container}`;
        }
      });

      // Add volumes
      volumes.forEach(vol => {
        if (typeof vol === 'string') {
          dockerCmd += ` -v ${vol}`;
        } else {
          dockerCmd += ` -v ${vol.host}:${vol.container}`;
        }
      });

      // Add environment variables
      Object.entries(env).forEach(([key, val]) => {
        dockerCmd += ` -e ${key}="${val}"`;
      });

      dockerCmd += ` ${image}`;

      if (cmd) dockerCmd += ` ${cmd}`;

      const { stdout } = await execAsync(dockerCmd);
      const containerId = stdout.trim();

      // Get container info
      const info = await this.getContainerInfo(containerId);

      this.containers.set(name || containerId, {
        id: containerId,
        name: name || containerId,
        image,
        status: 'running',
        startTime: Date.now(),
        restarts: 0
      });

      this.emit('start', { name: name || containerId, id: containerId });
      return { id: containerId, name: name || containerId, ...info };
    } catch (error) {
      this.emit('error', { error, action: 'start' });
      throw error;
    }
  }

  /**
   * Stop a container
   * @param {string} containerId - Container ID or name
   * @param {number} timeout - Timeout in seconds
   */
  async stopContainer(containerId, timeout = 10) {
    try {
      await execAsync(`docker stop -t ${timeout} ${containerId}`);
      
      const stored = this.containers.get(containerId);
      if (stored) {
        stored.status = 'stopped';
      }

      this.emit('stop', { id: containerId });
      return true;
    } catch (error) {
      this.emit('error', { error, action: 'stop', id: containerId });
      throw error;
    }
  }

  /**
   * Restart a container
   * @param {string} containerId - Container ID or name
   */
  async restartContainer(containerId) {
    try {
      await execAsync(`docker restart ${containerId}`);

      const stored = this.containers.get(containerId);
      if (stored) {
        stored.restarts += 1;
        stored.status = 'running';
        stored.startTime = Date.now();
      }

      this.emit('restart', { id: containerId });
      return true;
    } catch (error) {
      this.emit('error', { error, action: 'restart', id: containerId });
      throw error;
    }
  }

  /**
   * Get container information
   */
  async getContainerInfo(containerId) {
    try {
      const { stdout } = await execAsync(
        `docker inspect ${containerId} --format='{"id":"{{.ID}}","name":"{{.Name}}","state":"{{.State.Status}}","pid":"{{.State.Pid}}","memory":"{{.HostConfig.Memory}}","cpus":"{{.HostConfig.CpuQuota}}","ports":"{{json .NetworkSettings.Ports}}","uptime":"{{.State.StartedAt}}"}'`
      );

      const info = JSON.parse(stdout.trim().slice(1, -1)); // Remove surrounding quotes
      return info;
    } catch (error) {
      return { id: containerId };
    }
  }

  /**
   * List all containers
   */
  async listContainers(all = false) {
    try {
      const format = '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","ports":"{{.Ports}}"}';
      const cmd = all 
        ? `docker ps -a --format='${format}'`
        : `docker ps --format='${format}'`;

      const { stdout } = await execAsync(cmd);
      const lines = stdout.trim().split('\n').filter(x => x);
      return lines.map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      }).filter(x => x);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(containerId, options = {}) {
    const { tail = 100, follow = false } = options;

    try {
      const cmd = `docker logs --tail ${tail}${follow ? ' -f' : ''} ${containerId}`;
      
      if (!follow) {
        const { stdout } = await execAsync(cmd);
        return stdout;
      } else {
        // Return stream for follow mode
        return spawn('docker', ['logs', '--tail', tail.toString(), '-f', containerId]);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Execute command in container
   */
  async execInContainer(containerId, command) {
    try {
      const { stdout, stderr } = await execAsync(`docker exec ${containerId} ${command}`);
      return { stdout, stderr };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get container stats
   */
  async getContainerStats(containerId) {
    try {
      const format = '{"cpu":"{{.CPUPerc}}","memory":"{{.MemUsage}}","pid":"{{.PIDs}}"}';
      const { stdout } = await execAsync(`docker stats ${containerId} --no-stream --format='${format}'`);
      
      const stats = JSON.parse(stdout.trim());
      return stats;
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(containerId, force = false) {
    try {
      const forceFlag = force ? ' -f' : '';
      await execAsync(`docker rm${forceFlag} ${containerId}`);
      
      this.containers.delete(containerId);
      this.emit('remove', { id: containerId });
      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Pull image from registry
   */
  async pullImage(image) {
    try {
      await execAsync(`docker pull ${image}`);
      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get container uptime
   */
  getContainerUptime(containerId) {
    const stored = this.containers.get(containerId);
    if (!stored) return 0;
    return Date.now() - stored.startTime;
  }
}

module.exports = DockerAdapter;
