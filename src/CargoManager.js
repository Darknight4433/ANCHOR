const EventEmitter = require('events');
const DockerRuntime = require('./runtime/docker-runtime.js');
const ProcessRuntime = require('./runtime/process-runtime.js');
const Validator = require('./Validator.js');
const logger = require('./Logger.js');

/**
 * CargoManager - Unified orchestration layer for ANCHOR
 * A 'Cargo' can be a Docker Container (Primary) or Raw Process (Fallback)
 */
class CargoManager extends EventEmitter {
  constructor() {
    super();
    this.docker = new DockerRuntime();
    this.process = new ProcessRuntime();
    this.cargos = new Map(); // In-memory reference for lifecycle tracking
    this.useDocker = true; // Assumes true initially, checks later
  }

  async initialize() {
    this.useDocker = await this.docker.isAvailable();
    if (this.useDocker) {
      logger.info('⚓ [CargoManager] Operating in Container-First Mode (Docker Available)');
    } else {
      logger.warn('⚠️ [CargoManager] Docker unavailable. Operating in Process Fallback Mode');
    }
    
    // Bubble up errors from runtimes
    this.docker.on('error', (err) => this.emit('error', err));
    this.process.on('error', (err) => this.emit('error', err));
  }

  getPrimaryRuntime() {
    return this.useDocker ? this.docker : this.process;
  }

  /**
   * Create a new Cargo workload
   * @param {string} id - Unique cargo id
   * @param {string} blueprint - Docker image (or command for process)
   * @param {object} options - Ports, environment, limits
   */
  async createCargo(id, blueprint, options = {}) {
    Validator.validateProcessName(id); // Use same safe-string validation
    
    try {
      const runtime = this.getPrimaryRuntime();
      const result = await runtime.create(id, blueprint, options);
      
      const cargo = {
        id,
        blueprint,
        type: this.useDocker ? 'container' : 'process',
        containerId: result.containerId,
        status: result.status,
        options,
        createdAt: new Date().toISOString()
      };
      
      this.cargos.set(id, cargo);
      this.emit('cargo-created', cargo);
      return cargo;
    } catch (error) {
      throw new Error(`Failed to create cargo ${id}: ${error.message}`);
    }
  }

  /**
   * Start an existing Cargo
   */
  async startCargo(id) {
    const cargo = this.cargos.get(id);
    if (!cargo) throw new Error(`Cargo not found: ${id}`);
    
    try {
      const runtime = cargo.type === 'container' ? this.docker : this.process;
      const result = await runtime.start(id);
      cargo.status = result.status;
      
      this.emit('cargo-started', cargo);
      return cargo;
    } catch (error) {
      throw new Error(`Failed to start cargo ${id}: ${error.message}`);
    }
  }

  /**
   * Stop an existing Cargo
   */
  async stopCargo(id, force = false) {
    const cargo = this.cargos.get(id);
    if (!cargo) throw new Error(`Cargo not found: ${id}`);
    
    try {
      const runtime = cargo.type === 'container' ? this.docker : this.process;
      const timeout = force ? 0 : 10;
      const result = await runtime.stop(id, timeout);
      cargo.status = result.status;
      
      this.emit('cargo-stopped', cargo);
      return cargo;
    } catch (error) {
      throw new Error(`Failed to stop cargo ${id}: ${error.message}`);
    }
  }

  /**
   * Restart an existing Cargo
   */
  async restartCargo(id) {
    const cargo = this.cargos.get(id);
    if (!cargo) throw new Error(`Cargo not found: ${id}`);
    
    try {
      const runtime = cargo.type === 'container' ? this.docker : this.process;
      const result = await runtime.restart(id);
      cargo.status = result.status;
      
      this.emit('cargo-restarted', cargo);
      return cargo;
    } catch (error) {
      throw new Error(`Failed to restart cargo ${id}: ${error.message}`);
    }
  }

  /**
   * Remove a Cargo
   */
  async removeCargo(id, force = false) {
    const cargo = this.cargos.get(id);
    if (!cargo) throw new Error(`Cargo not found: ${id}`);
    
    try {
      const runtime = cargo.type === 'container' ? this.docker : this.process;
      await runtime.remove(id, force);
      
      this.cargos.delete(id);
      this.emit('cargo-removed', { id });
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to remove cargo ${id}: ${error.message}`);
    }
  }

  /**
   * Get live status of a Cargo
   */
  async getCargoStatus(id) {
    const cargo = this.cargos.get(id);
    if (!cargo) return null;
    
    try {
      const runtime = cargo.type === 'container' ? this.docker : this.process;
      const status = await runtime.getStatus(id);
      
      if (status) {
        cargo.status = status.status; // Sync internal state
        if (status.containerId) cargo.containerId = status.containerId;
        return { ...cargo, live: status };
      }
      return cargo;
    } catch (error) {
      return { ...cargo, status: 'error', error: error.message };
    }
  }

  getAllCargos() {
    return Array.from(this.cargos.values());
  }
}

module.exports = CargoManager;
