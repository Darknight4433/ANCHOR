const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const Validator = require('./Validator.js');
const ProcessState = require('./ProcessState.js');
const LifecycleValidator = require('./LifecycleValidator.js');

/**
 * ProcessManager - Production-grade process management system
 * Handles starting, stopping, restarting processes with PID tracking
 * Integrates ProcessState for single source of truth and crash recovery
 */
class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map(); // In-memory for active process refs
    this.processCounter = 0;
    this.state = new ProcessState(); // Single source of truth
  }

  /**
   * Start a new process
   * @param {string} command - Command to execute
   * @param {string[]} args - Command arguments
   * @param {object} options - Process options
   * @returns {object} Process info object
   */
  start(command, args = [], options = {}) {
    const {
      name = `process-${++this.processCounter}`,
      cwd = process.cwd(),
      env = process.env,
      stdio = 'inherit'
    } = options;

    // Input validation
    try {
      Validator.validateCommand(command);
      Validator.validateProcessName(name);
      if (!Array.isArray(args)) {
        throw new Error('Arguments must be an array');
      }
    } catch (validationError) {
      const error = new Error(`Validation failed: ${validationError.message}`);
      this.emit('error', { name, error });
      throw error;
    }

    // Check if process already exists
    if (this.processes.has(name)) {
      const existing = this.processes.get(name);
      if (existing.process && !existing.process.killed) {
        throw new Error(`Process "${name}" is already running with PID ${existing.pid}`);
      }
    }

    try {
      // Register in ProcessState BEFORE spawning (Principle 2: Lifecycle Order)
      this.state.registerProcess(name, {
        command,
        args,
        cwd,
        status: 'registered'
      });

      const childProcess = spawn(command, args, {
        cwd,
        env,
        stdio,
        detached: false
      });

      const startTime = Date.now();
      
      // Record process start in state (atomic write to disk)
      this.state.recordProcessStart(name, childProcess.pid);
      
      const processInfo = {
        name,
        command,
        args,
        pid: childProcess.pid,
        process: childProcess,
        startTime,
        restarts: 0,
        status: 'running',
        exitCode: null
      };

      this.processes.set(name, processInfo);

      // Handle process events
      childProcess.on('error', (err) => {
        processInfo.status = 'error';
        this.emit('error', { name, error: err });
      });

      childProcess.on('exit', (code, signal) => {
        processInfo.status = 'stopped';
        processInfo.exitCode = code;
        // Record stop in state (atomic write)
        this.state.recordProcessStop(name, code, signal);
        this.emit('exit', { name, code, signal });
      });

      this.emit('start', { name, pid: childProcess.pid });
      return this.getProcessInfo(name);
    } catch (error) {
      this.emit('error', { name, error });
      throw error;
    }
  }

  /**
   * Stop a running process
   * @param {string} name - Process name
   * @param {number} timeout - Timeout in ms before force kill (default: 5000)
   * @returns {boolean} Success status
   */
  stop(name, timeout = 5000) {
    const processInfo = this.processes.get(name);

    if (!processInfo) {
      throw new Error(`Process "${name}" not found`);
    }

    if (processInfo.status === 'stopped') {
      return true;
    }

    const { process: childProcess, pid } = processInfo;

    return new Promise((resolve) => {
      if (childProcess.killed) {
        processInfo.status = 'stopped';
        this.emit('stop', { name, pid });
        resolve(true);
        return;
      }

      let forceKilled = false;

      const timeoutHandle = setTimeout(() => {
        if (!forceKilled) {
          forceKilled = true;
          childProcess.kill('SIGKILL');
          this.emit('force-kill', { name, pid });
        }
      }, timeout);

      childProcess.once('exit', () => {
        clearTimeout(timeoutHandle);
        processInfo.status = 'stopped';
        this.emit('stop', { name, pid });
        resolve(true);
      });

      // Try graceful shutdown first
      childProcess.kill('SIGTERM');
    });
  }

  /**
   * Restart a process
   * @param {string} name - Process name
   * @returns {object} Process info after restart
   */
  async restart(name) {
    const processInfo = this.processes.get(name);

    if (!processInfo) {
      throw new Error(`Process "${name}" not found`);
    }

    const { command, args, cwd } = processInfo;

    // Stop the existing process
    await this.stop(name);

    // Wait a bit before restarting
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if process is still in state - if so, we need to reset it
    const stateInfo = this.state.getProcess(name);
    if (stateInfo && stateInfo.status === 'stopped') {
      // Remove from state so we can re-register
      this.state.removeProcess(name);
    }

    // Restart the process
    const newOptions = {
      name,
      cwd,
      env: process.env
    };

    const restarted = this.start(command, args, newOptions);
    const updatedInfo = this.processes.get(name);
    updatedInfo.restarts += 1;

    this.emit('restart', { name, restarts: updatedInfo.restarts });
    return restarted;
  }

  /**
   * Get process information
   * @param {string} name - Process name
   * @returns {object} Process info
   */
  getProcessInfo(name) {
    const processInfo = this.processes.get(name);

    if (!processInfo) {
      return null;
    }

    const uptime = processInfo.status === 'running' 
      ? Date.now() - processInfo.startTime 
      : 0;

    return {
      name: processInfo.name,
      pid: processInfo.pid,
      command: processInfo.command,
      args: processInfo.args,
      status: processInfo.status,
      uptime: this._formatUptime(uptime),
      uptimeMs: uptime,
      startTime: new Date(processInfo.startTime).toISOString(),
      restarts: processInfo.restarts,
      exitCode: processInfo.exitCode
    };
  }

  /**
   * Get all processes (reads from ProcessState for truth)
   * @returns {object[]} Array of process info
   */
  getAllProcesses() {
    const result = [];
    for (const name of this.processes.keys()) {
      const info = this.getProcessInfo(name);
      if (info) {
        result.push(info);
      }
    }
    return result;
  }

  /**
   * Recover state after crash
   * @returns {object} Recovery report
   */
  async recoverAfterCrash() {
    try {
      this.state.recoverAfterCrash();
      const recovery = this.state.getRecoveryReport();
      this.emit('recovery', recovery);
      return recovery;
    } catch (error) {
      this.emit('error', { error: new Error(`Recovery failed: ${error.message}`) });
      throw error;
    }
  }

  /**
   * Check if process exists and is running
   * @param {string} name - Process name
   * @returns {boolean}
   */
  isRunning(name) {
    const processInfo = this.processes.get(name);
    return processInfo && processInfo.status === 'running';
  }

  /**
   * Stop all processes
   * @returns {Promise<void>}
   */
  async stopAll() {
    const promises = [];
    for (const name of this.processes.keys()) {
      if (this.isRunning(name)) {
        promises.push(this.stop(name));
      }
    }
    await Promise.all(promises);
  }

  /**
   * Remove process from tracking
   * @param {string} name - Process name
   * @returns {boolean}
   */
  remove(name) {
    const processInfo = this.processes.get(name);

    if (!processInfo) {
      return false;
    }

    if (processInfo.status === 'running') {
      throw new Error(`Cannot remove running process "${name}". Stop it first.`);
    }

    return this.processes.delete(name);
  }

  /**
   * Format uptime to human readable format
   * @private
   */
  _formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

module.exports = ProcessManager;
