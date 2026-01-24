const fs = require('fs');
const EventEmitter = require('events');
const FsUtils = require('./FsUtils.js');

/**
 * LogRecovery - Handle logging failures gracefully
 * 
 * PRINCIPLE 5: Logging must never crash the platform
 * 
 * Handles:
 * - Missing log files
 * - Permission errors
 * - Disk full
 * - File truncation
 */
class LogRecovery extends EventEmitter {
  constructor() {
    super();
    this.failedLogs = new Map();
    this.recoveryAttempts = new Map();
  }

  /**
   * Attempt to recover a missing log file
   */
  attemptRecovery(name, logFile) {
    const attempts = this.recoveryAttempts.get(name) || 0;
    const maxAttempts = 5;

    if (attempts >= maxAttempts) {
      this.emit('recovery-failed', { 
        name, 
        logFile, 
        reason: `Max recovery attempts (${maxAttempts}) exceeded` 
      });
      return false;
    }

    try {
      // STRATEGY 1: Create missing file
      if (!fs.existsSync(logFile)) {
        FsUtils.ensureFile(logFile);
        this.emit('recovery-success', { 
          name, 
          action: 'recreated-missing-file' 
        });
        this.recoveryAttempts.set(name, 0);
        return true;
      }

      // STRATEGY 2: Fix permissions
      try {
        fs.accessSync(logFile, fs.constants.W_OK);
      } catch (error) {
        FsUtils.ensurePermissions(logFile, 0o644);
        this.emit('recovery-success', { 
          name, 
          action: 'fixed-permissions' 
        });
        this.recoveryAttempts.set(name, 0);
        return true;
      }

      return true;
    } catch (error) {
      this.recoveryAttempts.set(name, attempts + 1);
      this.emit('recovery-attempt-failed', { 
        name, 
        logFile, 
        attempt: attempts + 1,
        error: error.message 
      });
      return false;
    }
  }

  /**
   * Wrap file operation with recovery
   */
  withRecovery(name, logFile, operation) {
    try {
      return operation();
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File missing - attempt recovery
        if (this.attemptRecovery(name, logFile)) {
          // Retry operation
          try {
            return operation();
          } catch (retryError) {
            this.emit('error', { name, action: 'write-after-recovery', error: retryError });
            return false;
          }
        }
      } else if (error.code === 'EACCES') {
        // Permission denied
        this.attemptRecovery(name, logFile);
        this.emit('error', { name, action: 'permission-denied', error });
        return false;
      } else if (error.code === 'ENOSPC') {
        // Disk full - try rotation
        try {
          FsUtils.rotateFile(logFile);
          return operation();
        } catch (rotateError) {
          this.emit('error', { name, action: 'disk-full', error: rotateError });
          return false;
        }
      }

      this.emit('error', { name, action: 'unknown-error', error });
      return false;
    }
  }

  /**
   * Handle watcher error (file deleted, etc.)
   */
  handleWatcherError(name, logFile, error) {
    if (error.code === 'ENOENT') {
      // File was deleted - recreate and continue
      try {
        FsUtils.ensureFile(logFile);
        this.emit('watcher-recovery', { 
          name, 
          action: 'recreated-deleted-file' 
        });
        return true;
      } catch (recreateError) {
        this.emit('error', { name, action: 'watcher-recovery-failed', error: recreateError });
        return false;
      }
    }

    return false;
  }

  /**
   * Reset recovery counter (after successful operation)
   */
  resetRecoveryCounter(name) {
    this.recoveryAttempts.delete(name);
  }
}

module.exports = LogRecovery;
