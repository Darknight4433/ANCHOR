const EventEmitter = require('events');
const ProcessManager = require('../index.js'); // Use old ProcessManager as fallback

/**
 * ProcessRuntime - Fallback execution layer for ANCHOR Cargo
 * Wraps existing PM engine to match the identical Cargo interface
 */
class ProcessRuntime extends EventEmitter {
  constructor() {
    super();
    this.pm = new ProcessManager();
  }

  async isAvailable() {
    return true; // Node is always available to run processes
  }

  async create(id, blueprint, options = {}) {
    const { env = {}, cwd } = options;
    const command = blueprint.split(' ')[0];
    const args = blueprint.split(' ').slice(1);
    
    try {
      // In this runtime, create+start happen somewhat simultaneously in old PM,
      // but we will just stage it in ProcessState
      this.pm.state.registerProcess(id, {
        command,
        args,
        cwd: cwd || process.cwd(),
        env: { ...process.env, ...env },
        status: 'registered'
      });
      
      return { containerId: null, status: 'created' };
    } catch (error) {
      this.emit('error', { id, action: 'create', error: error.message });
      throw error;
    }
  }

  async start(id) {
    try {
      const proc = this.pm.state.getProcess(id);
      if (!proc) throw new Error(`Process ${id} not found`);
      
      const info = this.pm.start(proc.command, proc.args, { name: id, cwd: proc.cwd, env: proc.env });
      return { status: 'running', process: info };
    } catch (error) {
      this.emit('error', { id, action: 'start', error: error.message });
      throw error;
    }
  }

  async stop(id, timeout = 5) {
    try {
      if (this.pm.isRunning(id)) {
        await this.pm.stop(id, timeout * 1000);
      }
      return { status: 'stopped' };
    } catch (error) {
      this.emit('error', { id, action: 'stop', error: error.message });
      throw error;
    }
  }

  async restart(id) {
    try {
      await this.pm.restart(id);
      return { status: 'running' };
    } catch (error) {
      this.emit('error', { id, action: 'restart', error: error.message });
      throw error;
    }
  }

  async remove(id, force = false) {
    try {
      if (this.pm.isRunning(id)) {
        if (force) await this.stop(id, 1);
        else throw new Error("Cannot remove running process without force");
      }
      this.pm.remove(id);
      this.pm.state.deleteProcess(id);
      return { status: 'removed' };
    } catch (error) {
      this.emit('error', { id, action: 'remove', error: error.message });
      throw error;
    }
  }

  async getStatus(id) {
    const info = this.pm.getProcessInfo(id);
    if (!info) return null;
    return {
      containerId: null,
      status: info.status,
      startTime: info.startTime,
      pid: info.pid,
      exitCode: info.exitCode
    };
  }

  async attachLogs() {
    // Process runtime streaming uses the LogStreamService externally
    // Just a placeholder to match interface
    return null; 
  }
}

module.exports = ProcessRuntime;
