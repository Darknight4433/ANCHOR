const fs = require('fs');
const path = require('path');

/**
 * PersistenceManager - Handles state persistence and recovery
 */
class PersistenceManager {
  constructor(dataDir = null) {
    this.dataDir = dataDir || path.join(process.env.HOME || '/tmp', '.process-manager');
    this.stateFile = path.join(this.dataDir, 'state.json');
    this.pidFile = path.join(this.dataDir, 'daemon.pid');
    this.socketFile = path.join(this.dataDir, 'daemon.sock');
    
    this.ensureDataDirectory();
  }

  /**
   * Ensure data directory exists
   */
  ensureDataDirectory() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o755 });
    }
  }

  /**
   * Save process state
   */
  saveState(processes) {
    try {
      const state = {
        version: 1,
        timestamp: new Date().toISOString(),
        processes: Array.from(processes.entries()).map(([name, info]) => ({
          name,
          command: info.command,
          args: info.args,
          cwd: info.cwd || process.cwd(),
          env: info.env || {},
          autoStart: info.autoStart !== false, // Default to true
          restarts: info.restarts || 0
        }))
      };

      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving state:', error.message);
      return false;
    }
  }

  /**
   * Load process state
   */
  loadState() {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return { processes: [], version: 1 };
      }

      const data = fs.readFileSync(this.stateFile, 'utf8');
      const state = JSON.parse(data);
      return state;
    } catch (error) {
      console.error('Error loading state:', error.message);
      return { processes: [], version: 1 };
    }
  }

  /**
   * Save daemon PID
   */
  savePID(pid) {
    try {
      fs.writeFileSync(this.pidFile, pid.toString());
      return true;
    } catch (error) {
      console.error('Error saving PID:', error.message);
      return false;
    }
  }

  /**
   * Load daemon PID
   */
  loadPID() {
    try {
      if (!fs.existsSync(this.pidFile)) {
        return null;
      }
      return parseInt(fs.readFileSync(this.pidFile, 'utf8').trim());
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if daemon PID is still alive
   */
  isDaemonRunning() {
    const pid = this.loadPID();
    if (!pid) return false;

    try {
      // Sending signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clear PID file
   */
  clearPID() {
    try {
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
      }
      return true;
    } catch (error) {
      console.error('Error clearing PID:', error.message);
      return false;
    }
  }

  /**
   * Get socket file path
   */
  getSocketPath() {
    return this.socketFile;
  }

  /**
   * Get data directory
   */
  getDataDirectory() {
    return this.dataDir;
  }

  /**
   * Clear all state
   */
  clearAll() {
    try {
      if (fs.existsSync(this.stateFile)) fs.unlinkSync(this.stateFile);
      if (fs.existsSync(this.pidFile)) fs.unlinkSync(this.pidFile);
      if (fs.existsSync(this.socketFile)) fs.unlinkSync(this.socketFile);
      return true;
    } catch (error) {
      console.error('Error clearing state:', error.message);
      return false;
    }
  }

  /**
   * Get stats about persisted data
   */
  getStats() {
    try {
      const state = this.loadState();
      const daemonRunning = this.isDaemonRunning();
      const daemonPID = this.loadPID();

      return {
        dataDir: this.dataDir,
        processCount: state.processes.length,
        daemonRunning,
        daemonPID,
        lastUpdated: state.timestamp
      };
    } catch (error) {
      return {
        dataDir: this.dataDir,
        processCount: 0,
        daemonRunning: false,
        daemonPID: null,
        error: error.message
      };
    }
  }
}

module.exports = PersistenceManager;
