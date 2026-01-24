const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const FsUtils = require('./FsUtils.js');
const LogRecovery = require('./LogRecovery.js');

/**
 * LogStreamService - Production-grade real-time log streaming
 * Uses FsUtils for guaranteed file operations
 * Uses LogRecovery for graceful error handling
 * Implements Principle 3 (File System Guarantees) and Principle 5 (Logging Architecture)
 */
class LogStreamService extends EventEmitter {
  constructor(logDir = null) {
    super();
    this.logDir = logDir || path.join(process.env.HOME || '/tmp', '.process-manager', 'logs');
    this.streams = new Map();
    this.watchers = new Map();
    this.buffers = new Map();
    this.maxBufferSize = 10000; // Lines per buffer
    this.recovery = new LogRecovery(); // Error recovery handler

    this.ensureLogDirectory();
  }

  /**
   * Ensure log directory exists (Principle 3: guaranteed)
   */
  ensureLogDirectory() {
    try {
      FsUtils.ensureDir(this.logDir);
    } catch (error) {
      this.emit('error', { error: new Error(`Failed to ensure log directory: ${error.message}`) });
    }
  }

  /**
   * Start logging for a process (Principle 2: correct lifecycle order)
   */
  startLogging(processName, options = {}) {
    const { maxSize = this.maxBufferSize, persist = true } = options;

    // Initialize buffer
    this.buffers.set(processName, {
      lines: [],
      maxSize,
      created: Date.now()
    });

    if (persist) {
      try {
        // Ensure directory exists FIRST (Principle 3)
        FsUtils.ensureDir(this.logDir);
        
        // Ensure log file exists SECOND (Principle 3)
        const logFile = this.getLogFilePath(processName);
        FsUtils.ensureFile(logFile);

        // NOW create write stream (guaranteed safe)
        const writeStream = fs.createWriteStream(logFile, { flags: 'a' });

        writeStream.on('error', (error) => {
          this.emit('error', { processName, error, action: 'write' });
        });

        writeStream.on('open', () => {
          // Watch file (now guaranteed to exist)
          this.watchLogFile(processName, logFile);
        });

        this.streams.set(processName, writeStream);
      } catch (error) {
        this.emit('error', { processName, error, action: 'start-logging' });
      }
    }

    this.emit('logging-started', { processName });
    return true;
  }

  /**
   * Stop logging for a process
   */
  stopLogging(processName) {
    const stream = this.streams.get(processName);
    if (stream) {
      stream.end();
      this.streams.delete(processName);
    }

    const watcher = this.watchers.get(processName);
    if (watcher) {
      watcher.close();
      this.watchers.delete(processName);
    }

    this.emit('logging-stopped', { processName });
    return true;
  }

  /**
   * Write log entry (uses LogRecovery for error handling - Principle 5)
   */
  write(processName, message, level = 'info', metadata = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      metadata
    };

    // Add to buffer
    const buffer = this.buffers.get(processName);
    if (buffer) {
      buffer.lines.push(logEntry);

      // Keep buffer size in check
      if (buffer.lines.length > buffer.maxSize) {
        buffer.lines.shift();
      }
    }

    // Write to file with recovery
    const stream = this.streams.get(processName);
    if (stream) {
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : ''}\n`;
      
      // Wrap with recovery: if write fails, attempt to recover
      this.recovery.withRecovery(processName, this.getLogFilePath(processName), () => {
        stream.write(logLine);
      }).catch(error => {
        // Only emit if recovery completely failed
        this.emit('error', { processName, error, action: 'write-recovery-failed' });
      });
    }

    this.emit('log', { processName, logEntry });
    return logEntry;
  }

  /**
   * Get log entries
   */
  getLogs(processName, limit = 100, level = null) {
    const buffer = this.buffers.get(processName);
    if (!buffer) return [];

    let logs = buffer.lines;

    // Filter by level if specified
    if (level) {
      logs = logs.filter(l => l.level === level);
    }

    // Return last N
    return logs.slice(-limit);
  }

  /**
   * Stream logs to a callback
   */
  streamLogs(processName, callback, options = {}) {
    const { tail = 0, level = null } = options;

    // Send existing logs
    const existingLogs = this.getLogs(processName, tail || 100, level);
    existingLogs.forEach(log => callback(null, log));

    // Listen for new logs
    const onLog = ({ processName: pName, logEntry }) => {
      if (pName === processName) {
        if (!level || logEntry.level === level) {
          callback(null, logEntry);
        }
      }
    };

    this.on('log', onLog);

    // Return unsubscribe function
    return () => {
      this.removeListener('log', onLog);
    };
  }

  /**
   * Watch log file for external changes (with LogRecovery - Principle 5)
   */
  watchLogFile(processName, logFile) {
    try {
      const watcher = fs.watch(logFile, (eventType, filename) => {
        if (eventType === 'change') {
          this.emit('file-changed', { processName, file: logFile });
        }
      });

      watcher.on('error', (error) => {
        // Use LogRecovery for watcher errors
        this.recovery.handleWatcherError(processName, logFile, error)
          .then(() => {
            this.emit('watcher-recovered', { processName });
          })
          .catch(recoveryError => {
            if (error.code !== 'ENOENT') {
              this.emit('error', { processName, error: recoveryError, action: 'watch-recovery' });
            }
          });
      });

      this.watchers.set(processName, watcher);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.emit('error', { processName, error, action: 'watch' });
      }
    }
  }

  /**
   * Get log file path
   */
  getLogFilePath(processName) {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${processName}-${timestamp}.log`;
    return path.join(this.logDir, filename);
  }

  /**
   * Read log file (with FsUtils guarantees)
   */
  async readLogFile(processName, lines = 100) {
    try {
      const logFile = this.getLogFilePath(processName);

      // Use FsUtils.isSafePath to prevent traversal attacks
      if (!FsUtils.isSafePath(this.logDir, logFile)) {
        throw new Error('Unsafe path detected');
      }

      if (!fs.existsSync(logFile)) {
        return [];
      }

      const content = fs.readFileSync(logFile, 'utf8');
      const allLines = content.split('\n').filter(l => l.trim());

      return allLines.slice(-lines);
    } catch (error) {
      this.emit('error', { processName, error, action: 'read' });
      return [];
    }
  }

  /**
   * Clear logs
   */
  clearLogs(processName) {
    const buffer = this.buffers.get(processName);
    if (buffer) {
      buffer.lines = [];
    }

    const logFile = this.getLogFilePath(processName);
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }

    this.emit('logs-cleared', { processName });
    return true;
  }

  /**
   * Get log directory size
   */
  getLogDirectorySize() {
    let totalSize = 0;

    const walk = (dir) => {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          totalSize += stat.size;
        } else if (stat.isDirectory()) {
          walk(fullPath);
        }
      });
    };

    try {
      walk(this.logDir);
    } catch (error) {
      this.emit('error', { error, action: 'size' });
    }

    return totalSize;
  }

  /**
   * Rotate old log files
   */
  rotateLogs(maxAgeDays = 7) {
    try {
      const now = Date.now();
      const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;

      const files = fs.readdirSync(this.logDir);
      let rotated = 0;

      files.forEach(file => {
        const fullPath = path.join(this.logDir, file);
        const stat = fs.statSync(fullPath);

        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(fullPath);
          rotated++;
        }
      });

      this.emit('logs-rotated', { rotated });
      return rotated;
    } catch (error) {
      this.emit('error', { error, action: 'rotate' });
      return 0;
    }
  }

  /**
   * Search logs
   */
  async searchLogs(processName, query, options = {}) {
    try {
      const { regex = false, limit = 100, level = null } = options;

      const buffer = this.buffers.get(processName);
      if (!buffer) return [];

      let results = buffer.lines;

      // Filter by level
      if (level) {
        results = results.filter(l => l.level === level);
      }

      // Search
      const matcher = regex ? new RegExp(query) : (l) => l.message.includes(query);
      if (regex) {
        results = results.filter(l => matcher.test(l.message));
      } else {
        results = results.filter(l => matcher(l));
      }

      return results.slice(-limit);
    } catch (error) {
      this.emit('error', { processName, error, action: 'search' });
      return [];
    }
  }

  /**
   * Get logging stats
   */
  getStats() {
    const stats = {
      logDir: this.logDir,
      directorySize: this.getLogDirectorySize(),
      trackedProcesses: this.buffers.size,
      processes: []
    };

    for (const [name, buffer] of this.buffers.entries()) {
      stats.processes.push({
        name,
        lineCount: buffer.lines.length,
        maxSize: buffer.maxSize,
        created: buffer.created
      });
    }

    return stats;
  }
}

module.exports = LogStreamService;
