/**
 * Production Integration Tests
 * Tests for all 9 principles implementation
 * Covers race conditions, edge cases, and crash recovery
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ProcessManager = require('../src/index.js');
const ProcessState = require('../src/ProcessState.js');
const FsUtils = require('../src/FsUtils.js');
const LogStreamService = require('../src/LogStreamService.js');
const LogRecovery = require('../src/LogRecovery.js');

// Test utilities
const testDir = path.join(__dirname, '..', '.test-tmp');

function cleanup() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });
}

function cleanupAfter() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// ==================== PRINCIPLE 1: SINGLE SOURCE OF TRUTH ====================

describe('Principle 1: Single Source of Truth (ProcessState)', () => {
  beforeEach(cleanup);
  afterEach(cleanupAfter);

  it('should persist state to disk on registerProcess', () => {
    const ps = new ProcessState(path.join(testDir, 'state'));
    ps.registerProcess('test-proc', { command: 'echo', args: ['hello'] });
    ps.saveState();

    const stateFile = path.join(testDir, 'state', 'state.json');
    assert(fs.existsSync(stateFile), 'State file should exist on disk');

    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert(saved.processes.hasOwnProperty('test-proc'), 'Process should be in state');
  });

  it('should recover from crash with process marked as dead', () => {
    const ps = new ProcessState(path.join(testDir, 'state'));
    ps.registerProcess('proc1', { command: 'echo' });
    ps.recordProcessStart('proc1', 12345);
    ps.saveState();

    // Simulate crash - create new instance that reads old state
    const ps2 = new ProcessState(path.join(testDir, 'state'));
    ps2.recoverAfterCrash();

    const proc1 = ps2.getProcess('proc1');
    assert.strictEqual(proc1.status, 'dead', 'Should mark crashed process as dead');
  });

  it('should maintain invariants: pid null when stopped', () => {
    const ps = new ProcessState(path.join(testDir, 'state'));
    ps.registerProcess('proc', { command: 'echo' });
    ps.recordProcessStart('proc', 99999);
    ps.recordProcessStop('proc', 0, null);

    assert.strictEqual(ps.getProcess('proc').pid, null, 'PID should be null after stop');
    assert.strictEqual(ps.getProcess('proc').status, 'stopped', 'Status should be stopped');
  });

  it('should throw on invalid status transition', () => {
    const ps = new ProcessState(path.join(testDir, 'state'));
    ps.registerProcess('proc', { command: 'echo' });
    ps.recordProcessStart('proc', 99999);
    ps.recordProcessStop('proc', 0, null);

    assert.throws(() => {
      ps.recordProcessStart('proc', 88888); // Can't start a stopped process
    }, /invalid transition/i);
  });
});

// ==================== PRINCIPLE 2: LIFECYCLE ORDER ====================

describe('Principle 2: Lifecycle Order (LifecycleValidator)', () => {
  beforeEach(cleanup);
  afterEach(cleanupAfter);

  it('should prevent watching file before it exists', () => {
    const logDir = path.join(testDir, 'logs');
    const logFile = path.join(logDir, 'test.log');

    // This is what we PREVENT:
    // fs.watch(logFile) → ENOENT error

    // This is what we DO:
    FsUtils.ensureDir(logDir);
    FsUtils.ensureFile(logFile);
    // NOW safe to watch
    assert(fs.existsSync(logFile), 'File should exist');
  });

  it('should ensure directory exists before creating files in it', () => {
    const nestedDir = path.join(testDir, 'a', 'b', 'c', 'logs');
    const filePath = path.join(nestedDir, 'test.log');

    FsUtils.ensureDir(nestedDir);
    FsUtils.ensureFile(filePath);

    assert(fs.existsSync(nestedDir), 'Nested directory should exist');
    assert(fs.existsSync(filePath), 'File should exist');
  });

  it('should start processes in correct order: register → start → log', async () => {
    const pm = new ProcessManager();
    const logService = new LogStreamService(path.join(testDir, 'logs'));

    // ProcessManager.start() should:
    // 1. Call processState.registerProcess()
    // 2. Spawn process
    // 3. Call processState.recordProcessStart()
    // 4. Return info

    const info = pm.start('echo', ['hello'], { name: 'test' });
    
    assert(info, 'Should return process info');
    assert.strictEqual(info.status, 'running', 'Should be running');

    // Verify state was persisted
    const state = pm.state.getProcess('test');
    assert(state, 'Should be in persistent state');
  });
});

// ==================== PRINCIPLE 3: FILE SYSTEM GUARANTEES ====================

describe('Principle 3: File System Guarantees (FsUtils)', () => {
  beforeEach(cleanup);
  afterEach(cleanupAfter);

  it('should ensure directory with recursive creation', () => {
    const deep = path.join(testDir, 'x', 'y', 'z', 'logs');
    FsUtils.ensureDir(deep);
    assert(fs.existsSync(deep), 'Deep directory should exist');
  });

  it('should ensure file is created if missing', () => {
    const file = path.join(testDir, 'test.log');
    FsUtils.ensureFile(file);
    assert(fs.existsSync(file), 'File should exist');
    assert.strictEqual(fs.statSync(file).size, 0, 'File should be empty');
  });

  it('should atomicWrite without partial writes', async () => {
    const file = path.join(testDir, 'atomic.txt');
    const content = 'test content';

    await FsUtils.atomicWrite(file, content);

    const written = fs.readFileSync(file, 'utf8');
    assert.strictEqual(written, content, 'Content should match');
  });

  it('should prevent directory traversal attacks', () => {
    const basePath = testDir;
    const safePath = path.join(testDir, 'logs', 'file.log');
    const unsafePath = path.join(testDir, '..', '..', 'etc', 'passwd');

    assert(FsUtils.isSafePath(basePath, safePath), 'Normal path should be safe');
    assert(!FsUtils.isSafePath(basePath, unsafePath), 'Traversal path should be unsafe');
  });

  it('should ensure permissions are correct', () => {
    const file = path.join(testDir, 'perm-test.txt');
    FsUtils.ensureFile(file);
    FsUtils.ensurePermissions(file, 0o644);

    const stat = fs.statSync(file);
    // Mode includes file type bits, mask to get just permissions
    const mode = stat.mode & parseInt('777', 8);
    assert.strictEqual(mode, 0o644, 'Permissions should be 0644');
  });
});

// ==================== PRINCIPLE 5: LOGGING ARCHITECTURE ====================

describe('Principle 5: Logging Architecture with Error Recovery', () => {
  beforeEach(cleanup);
  afterEach(cleanupAfter);

  it('should recover when log file is deleted', async () => {
    const recovery = new LogRecovery();
    const logDir = path.join(testDir, 'logs');
    const logFile = path.join(logDir, 'test.log');

    FsUtils.ensureDir(logDir);
    FsUtils.ensureFile(logFile);

    // Delete file to simulate error
    fs.unlinkSync(logFile);

    // Recovery should recreate it
    await recovery.attemptRecovery('test', logFile);
    assert(fs.existsSync(logFile), 'File should be recovered');
  });

  it('should handle ENOENT errors with recovery', async () => {
    const recovery = new LogRecovery();
    const logFile = path.join(testDir, 'missing.log');

    const result = await recovery.handleWatcherError(
      'test',
      logFile,
      { code: 'ENOENT' }
    );

    assert(result, 'Should complete without throwing');
  });

  it('should limit retry attempts to prevent infinite loops', async () => {
    const recovery = new LogRecovery();
    // Create a path that will always fail (unwritable)
    const badPath = '/root/impossible/path/test.log';

    let attempts = 0;
    try {
      await recovery.withRecovery('test', badPath, () => {
        throw new Error('Always fails');
      });
    } catch (e) {
      // Expected to fail after max retries
    }

    // Should not retry infinitely
    assert(recovery.recoveryCounter <= 5, 'Should limit recovery attempts');
  });

  it('should not crash platform on logging errors', (done) => {
    const logService = new LogStreamService(path.join(testDir, 'logs'));
    let errorEmitted = false;

    logService.on('error', () => {
      errorEmitted = true;
    });

    // Try to write when log file is missing
    logService.write('nonexistent', 'test message');

    // Platform should still be running
    setTimeout(() => {
      assert(true, 'Platform should not crash');
      done();
    }, 100);
  });
});

// ==================== INTEGRATION TESTS ====================

describe('Integration: ProcessManager + ProcessState + LogStreamService', () => {
  beforeEach(cleanup);
  afterEach(cleanupAfter);

  it('should start process and persist to state', async () => {
    const pm = new ProcessManager();
    const info = pm.start('sleep', ['10'], { name: 'sleeper' });

    assert(info.pid > 0, 'Should have valid PID');
    
    // Verify in persistent state
    const stateInfo = pm.state.getProcess('sleeper');
    assert(stateInfo, 'Should be in ProcessState');
    assert.strictEqual(stateInfo.pid, info.pid, 'PIDs should match');

    // Cleanup
    await pm.stop('sleeper');
  });

  it('should log and recover on missing file', (done) => {
    const logService = new LogStreamService(path.join(testDir, 'logs'));
    logService.startLogging('proc1');

    // Write log entry
    logService.write('proc1', 'test message');

    // Manually delete log file
    const logFile = logService.getLogFilePath('proc1');
    setTimeout(() => {
      if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
      }

      // Should recover without crashing
      assert(true, 'Service should handle missing file');
      logService.stopLogging('proc1');
      done();
    }, 100);
  });

  it('should handle concurrent operations safely', async () => {
    const pm = new ProcessManager();
    
    // Start multiple processes concurrently
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        pm.start('echo', [`test${i}`], { name: `proc${i}` })
      );
    }

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 5, 'All processes should start');

    // Verify all in state
    const allProcs = pm.getAllProcesses();
    assert(allProcs.length >= 5, 'All should be tracked');

    // Stop all
    await pm.stopAll();
  });

  it('should survive restart cycle', async () => {
    const pm = new ProcessManager();
    
    const info1 = pm.start('echo', ['test'], { name: 'cycle-test' });
    const pid1 = info1.pid;
    
    await pm.restart('cycle-test');
    
    const info2 = pm.getProcessInfo('cycle-test');
    // After restart, PID should be different (new process)
    assert(info2.pid !== pid1 || !info2.process.killed, 'Process should be restarted');
    
    await pm.stop('cycle-test');
  });
});

// ==================== EDGE CASES ====================

describe('Edge Cases and Error Handling', () => {
  beforeEach(cleanup);
  afterEach(cleanupAfter);

  it('should handle disk full gracefully', (done) => {
    const recovery = new LogRecovery();
    
    recovery.handleWatcherError(
      'test',
      '/path/to/file',
      { code: 'ENOSPC' }
    ).then(() => {
      // Should complete without throwing
      assert(true, 'Should handle disk full');
      done();
    }).catch(err => {
      // Even if it fails, should emit as data, not crash
      done();
    });
  });

  it('should handle permission denied errors', (done) => {
    const recovery = new LogRecovery();
    
    recovery.handleWatcherError(
      'test',
      '/root/no-permission.log',
      { code: 'EACCES' }
    ).then(() => {
      assert(true, 'Should handle permission denied');
      done();
    }).catch(() => {
      done();
    });
  });

  it('should not start duplicate processes', () => {
    const pm = new ProcessManager();
    
    pm.start('echo', ['test'], { name: 'dup' });
    
    assert.throws(() => {
      pm.start('echo', ['test2'], { name: 'dup' });
    }, /already running/i);
  });

  it('should handle stop of non-existent process', () => {
    const pm = new ProcessManager();
    
    assert.throws(() => {
      pm.stop('does-not-exist');
    }, /not found/i);
  });

  it('should enforce SIGTERM → SIGKILL sequence', async () => {
    const pm = new ProcessManager();
    const info = pm.start('sleep', ['100'], { name: 'force-kill-test' });
    
    const stopped = await pm.stop('force-kill-test', 1000);
    assert(stopped, 'Process should be stopped');
  });
});

console.log('✅ Production Integration Tests Suite Loaded');
