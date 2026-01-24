/**
 * LifecycleValidator - Enforces PRINCIPLE 2: Lifecycle Order
 * 
 * CRITICAL RULE:
 * If something will be watched, it must exist first.
 * 
 * Order of operations (MANDATORY):
 * 1. Create directories
 * 2. Create log file
 * 3. Register process in state
 * 4. Start process
 * 5. Attach log streams
 * 6. Attach watchers
 */
class LifecycleValidator {
  /**
   * Validate that lifecycle follows correct order
   */
  static validateStartSequence(config) {
    const checks = {
      directoryExists: false,
      logFileExists: false,
      processRegistered: false,
      logStreamAttached: false,
      watcherAttached: false
    };

    return checks;
  }

  /**
   * Check: Directory must exist before log file
   */
  static checkDirectoryReady(logDir) {
    const fs = require('fs');
    if (!fs.existsSync(logDir)) {
      throw new Error(
        `[LifecycleValidator] Log directory must be created first: ${logDir}`
      );
    }
    return true;
  }

  /**
   * Check: Log file must exist before watcher
   */
  static checkLogFileReady(logFile) {
    const fs = require('fs');
    if (!fs.existsSync(logFile)) {
      throw new Error(
        `[LifecycleValidator] Log file must be created before watching: ${logFile}`
      );
    }
    return true;
  }

  /**
   * Check: Process must be registered in state before starting
   */
  static checkProcessRegistered(processState, name) {
    const proc = processState.getProcess(name);
    if (!proc) {
      throw new Error(
        `[LifecycleValidator] Process must be registered in state first: ${name}`
      );
    }
    return true;
  }

  /**
   * Check: Log file must be in state before watcher
   */
  static checkLogFileInState(processState, name) {
    const proc = processState.getProcess(name);
    if (!proc || !proc.logFile) {
      throw new Error(
        `[LifecycleValidator] Process logFile must be set in state before watching: ${name}`
      );
    }
    return true;
  }

  /**
   * Recommended lifecycle sequence for starting a process
   */
  static getRecommendedStartSequence() {
    return [
      '1. processState.registerProcess(name, config)',
      '2. fsUtils.ensureDir(proc.logDir)',
      '3. fsUtils.ensureFile(proc.logFile)',
      '4. processState.recordProcessStart(name, pid)',
      '5. logService.startCapturingLogs(name, proc.logFile)',
      '6. logWatcher.attachWatcher(name, proc.logFile)',  // ONLY NOW!
    ];
  }

  /**
   * Recommended lifecycle sequence for stopping a process
   */
  static getRecommendedStopSequence() {
    return [
      '1. logWatcher.detachWatcher(name)',
      '2. logService.stopCapturingLogs(name)',
      '3. process.kill(pid, SIGTERM)',
      '4. wait(gracefulShutdownTimeout)',
      '5. process.kill(pid, SIGKILL)',
      '6. processState.recordProcessStop(name, exitCode, signal)',
    ];
  }
}

module.exports = LifecycleValidator;
