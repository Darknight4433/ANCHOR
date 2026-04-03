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
      // Build docker command arguments (safe from injection)
      const dockerArgs = ['run'];

      if (detach) dockerArgs.push('-d');
      if (name) {
        dockerArgs.push('--name', name);
      }
      if (memory) {
        dockerArgs.push('--memory', memory);
      }
      if (cpus) {
        dockerArgs.push('--cpus', cpus);
      }

      // Add ports
      ports.forEach(port => {
        if (typeof port === 'string') {
          dockerArgs.push('-p', port);
        } else {
          dockerArgs.push('-p', `${port.host}:${port.container}`);
        }
      });

      // Add volumes
      volumes.forEach(vol => {
        if (typeof vol === 'string') {
          dockerArgs.push('-v', vol);
        } else {
          dockerArgs.push('-v', `${vol.host}:${vol.container}`);
        }
      });

      // Add environment variables
      Object.entries(env).forEach(([key, val]) => {
        dockerArgs.push('-e', `${key}=${val}`);
      });

      dockerArgs.push(image);

      if (cmd) {
        if (Array.isArray(cmd)) {
          dockerArgs.push(...cmd);
        } else {
          dockerArgs.push(cmd);
        }
      }

      const child = spawn('docker', dockerArgs, { stdio: 'pipe' });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      return new Promise((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0) {
            const containerId = stdout.trim();
            // Get container info
            this.getContainerInfo(containerId).then(info => {
              this.containers.set(name || containerId, {
                id: containerId,
                name: name || containerId,
                image,
                status: 'running',
                startTime: Date.now(),
                restarts: 0
              });

              this.emit('start', { name: name || containerId, id: containerId });
              resolve({ id: containerId, name: name || containerId, ...info });
            }).catch(reject);
          } else {
            reject(new Error(`Docker command failed: ${stderr}`));
          }
        });

        child.on('error', reject);
      });
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

    const cmd = `docker logs --tail ${tail}${follow ? ' -f' : ''} ${containerId}`;
    
    if (!follow) {
      const { stdout } = await execAsync(cmd);
      return stdout;
    } else {
      // Return stream for follow mode
      return spawn('docker', ['logs', '--tail', tail.toString(), '-f', containerId]);
    }
  }

  /**
   * Execute command in container
   */
  async execInContainer(containerId, command) {
    const { stdout, stderr } = await execAsync(`docker exec ${containerId} ${command}`);
    return { stdout, stderr };
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
    const forceFlag = force ? ' -f' : '';
    await execAsync(`docker rm${forceFlag} ${containerId}`);
    
    this.containers.delete(containerId);
    this.emit('remove', { id: containerId });
    return true;
  }

  /**
   * Pull image from registry
   */
  async pullImage(image) {
    await execAsync(`docker pull ${image}`);
    return true;
  }

  /**
   * Build image from a local context directory
   */
  async buildImage(contextPath, tag, dockerfilePath = null) {
    const dockerArgs = ['build', '-t', tag];
    if (dockerfilePath) {
      dockerArgs.push('-f', dockerfilePath);
    }
    dockerArgs.push(contextPath);

    const child = spawn('docker', dockerArgs, { stdio: 'pipe' });
    let stderr = '';

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    return new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ tag });
          return;
        }
        reject(new Error(`Docker build failed: ${stderr}`));
      });

      child.on('error', reject);
    });
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
