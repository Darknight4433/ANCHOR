const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

/**
 * ProcessState - Single Source of Truth for all process metadata
 * 
 * PRINCIPLE: All process state must be:
 * - Persisted to disk
 * - Atomically updated
 * - Validated on read
 * - Accessible by all subsystems
 * 
 * NOT stored in memory-only
 */
class ProcessState extends EventEmitter {
  constructor(dataDir = null) {
    super();
    this.dataDir = dataDir || path.join(process.env.HOME || '/tmp', '.process-manager');
    this.processesDir = path.join(this.dataDir, 'processes');
    this.stateFile = path.join(this.dataDir, 'state.json');
    
    // Ensure directories exist
    this.ensureDirectories();
    
    // Load initial state
    this.state = this.loadState();
  }

  /**
   * GUARANTEE A: Directories must exist
   * PRINCIPLE: Never assume directories exist
   */
  ensureDirectories() {
    for (const dir of [this.dataDir, this.processesDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      }
    }
  }

  /**
   * GUARANTEE B: State file must exist and be valid
   * PRINCIPLE: Create if missing, validate format
   */
  loadState() {
    if (!fs.existsSync(this.stateFile)) {
      return this.createEmptyState();
    }

    try {
      const content = fs.readFileSync(this.stateFile, 'utf8');
      const state = JSON.parse(content);
      this.validateStateSchema(state);
      return state;
    } catch (error) {
      console.warn(`[ProcessState] Invalid state.json, creating new: ${error.message}`);
      return this.createEmptyState();
    }
  }

  /**
   * Create empty state with guaranteed schema
   */
  createEmptyState() {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processes: {},
      metadata: {
        totalProcesses: 0,
        totalRestarts: 0
      }
    };
  }

  /**
   * Schema validation - PRINCIPLE: Enforce invariants
   */
  validateStateSchema(state) {
    if (!state.processes || typeof state.processes !== 'object') {
      throw new Error('Invalid state: missing processes object');
    }
    if (typeof state.metadata !== 'object') {
      throw new Error('Invalid state: missing metadata object');
    }
  }

  /**
   * ATOMIC UPDATE: Write to temp file, then rename
   * PRINCIPLE: Never partially write state
   */
  saveState() {
    const tempFile = this.stateFile + '.tmp';
    
    try {
      this.state.updatedAt = new Date().toISOString();
      
      const data = JSON.stringify(this.state, null, 2);
      fs.writeFileSync(tempFile, data, 'utf8');
      
      // Atomic rename
      fs.renameSync(tempFile, this.stateFile);
      
      this.emit('state-saved', { timestamp: this.state.updatedAt });
      return true;
    } catch (error) {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      this.emit('error', { error, action: 'save-state' });
      throw error;
    }
  }

  /**
   * Register a new process
   * PRINCIPLE: Single point of truth - all metadata here
   */
  registerProcess(name, config) {
    if (this.state.processes[name]) {
      throw new Error(`Process already registered: ${name}`);
    }

    this.state.processes[name] = {
      name,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      
      // Lifecycle tracking (CRITICAL)
      pid: null,
      status: 'registered',     // registered → starting → running → stopped
      startTime: null,
      stopTime: null,
      exitCode: null,
      signal: null,
      
      // Log paths (CRITICAL for log service)
      logDir: path.join(this.dataDir, 'logs', name),
      logFile: null,            // Set when process actually starts
      
      // Restart tracking
      restarts: 0,
      lastRestartTime: null,
      restartReason: null,
      
      // Metadata
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      
      // Configuration
      config: {
        autoRestart: config.autoRestart !== false,
        restartDelay: config.restartDelay || 1000,
        gracefulShutdownTimeout: config.gracefulShutdownTimeout || 5000
      }
    };

    this.state.metadata.totalProcesses++;
    this.saveState();
    
    this.emit('process-registered', { name });
    return this.state.processes[name];
  }

  /**
   * Update process on start
   * PRINCIPLE: Lifecycle order enforced here
   */
  recordProcessStart(name, pid) {
    const proc = this.state.processes[name];
    if (!proc) throw new Error(`Process not found: ${name}`);

    // Set up log file path NOW (before watchers)
    proc.logFile = path.join(proc.logDir, `${name}-${new Date().toISOString().split('T')[0]}.log`);
    
    // Ensure log directory
    if (!fs.existsSync(proc.logDir)) {
      fs.mkdirSync(proc.logDir, { recursive: true, mode: 0o755 });
    }

    proc.pid = pid;
    proc.status = 'running';
    proc.startTime = Date.now();
    proc.updatedAt = new Date().toISOString();
    
    this.saveState();
    this.emit('process-started', { name, pid });
    
    return proc;
  }

  /**
   * Update process on stop
   */
  recordProcessStop(name, exitCode, signal) {
    const proc = this.state.processes[name];
    if (!proc) throw new Error(`Process not found: ${name}`);

    proc.status = 'stopped';
    proc.stopTime = Date.now();
    proc.exitCode = exitCode;
    proc.signal = signal;
    proc.pid = null;
    proc.updatedAt = new Date().toISOString();
    
    this.saveState();
    this.emit('process-stopped', { name, exitCode, signal });
  }

  /**
   * Record restart
   */
  recordRestart(name, reason) {
    const proc = this.state.processes[name];
    if (!proc) throw new Error(`Process not found: ${name}`);

    proc.restarts++;
    proc.lastRestartTime = Date.now();
    proc.restartReason = reason;
    proc.status = 'restarting';
    proc.updatedAt = new Date().toISOString();
    
    this.state.metadata.totalRestarts++;
    this.saveState();
    
    this.emit('process-restart-recorded', { name, restarts: proc.restarts });
  }

  /**
   * Get process state
   * PRINCIPLE: Always read from disk, not memory
   */
  getProcess(name) {
    // For consistency, reload state
    const latest = this.loadState();
    return latest.processes[name] || null;
  }

  /**
   * Get all processes
   */
  getAllProcesses() {
    const latest = this.loadState();
    return Object.values(latest.processes);
  }

  /**
   * Delete process from state
   */
  deleteProcess(name) {
    const proc = this.state.processes[name];
    if (!proc) throw new Error(`Process not found: ${name}`);

    delete this.state.processes[name];
    this.state.metadata.totalProcesses--;
    this.saveState();
    
    this.emit('process-deleted', { name });
  }

  /**
   * Verify invariants - PRINCIPLE: Catch state corruption
   */
  verifyInvariants() {
    const issues = [];

    for (const [name, proc] of Object.entries(this.state.processes)) {
      // If running, must have PID
      if (proc.status === 'running' && !proc.pid) {
        issues.push(`[${name}] Status is running but no PID`);
      }

      // If stopped, must not have PID
      if (proc.status === 'stopped' && proc.pid) {
        issues.push(`[${name}] Status is stopped but has PID ${proc.pid}`);
      }

      // Log file must be set if started
      if (proc.startTime && !proc.logFile) {
        issues.push(`[${name}] Has startTime but no logFile`);
      }
    }

    if (issues.length > 0) {
      this.emit('invariant-violation', { issues });
      return false;
    }

    return true;
  }

  /**
   * Recovery: Fix processes marked as running after crash
   */
  recoverAfterCrash() {
    let recovered = 0;

    for (const [name, proc] of Object.entries(this.state.processes)) {
      if (proc.status === 'running' && proc.pid) {
        // Check if process still exists
        try {
          process.kill(proc.pid, 0);  // Signal 0: check existence
        } catch (error) {
          // Process doesn't exist - mark as crashed
          proc.status = 'crashed';
          proc.pid = null;
          this.emit('process-recovery', { name, action: 'marked-as-crashed' });
          recovered++;
        }
      }
    }

    if (recovered > 0) {
      this.saveState();
    }

    return recovered;
  }

  /**
   * Remove a process from state
   * @param {string} name - Process name
   * @returns {boolean} Success
   */
  removeProcess(name) {
    if (this.state.processes.hasOwnProperty(name)) {
      delete this.state.processes[name];
      this.saveState();
      return true;
    }
    return false;
  }

  /**
   * Get recovery report
   * @returns {object} Recovery information
   */
  getRecoveryReport() {
    return {
      timestamp: new Date().toISOString(),
      totalProcesses: Object.keys(this.state.processes).length,
      processes: this.state.processes
    };
  }
}

module.exports = ProcessState;
