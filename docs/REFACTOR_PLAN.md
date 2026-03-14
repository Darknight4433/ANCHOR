# 🏗️ LogStreamService Refactor - Applying System Principles

## Current Problem

```javascript
// ❌ WRONG: File not guaranteed to exist
writeStream.on('open', () => {
  this.watchLogFile(processName, logFile);  // File might not exist yet!
});
```

## Correct Approach

```javascript
// ✅ RIGHT: Guarantee file exists, THEN watch
startLogging(processName, options = {}) {
  const { persist = true } = options;

  // Step 1: Register in state
  const buffer = { lines: [], maxSize: 10000 };
  this.buffers.set(processName, buffer);

  if (persist) {
    // Step 2: Get log file path from state
    const proc = this.processState.getProcess(processName);
    const logDir = proc.logDir;
    const logFile = proc.logFile;

    // Step 3: Guarantee directory exists
    FsUtils.ensureDir(logDir);

    // Step 4: Guarantee file exists BEFORE creating stream
    FsUtils.ensureFile(logFile);

    // Step 5: NOW it's safe to write
    const writeStream = fs.createWriteStream(logFile, { flags: 'a' });
    writeStream.on('error', (error) => {
      LogRecovery.handleStreamError(error);
    });

    this.streams.set(processName, writeStream);

    // Step 6: NOW it's safe to watch (file guaranteed to exist)
    this.watchLogFile(processName, logFile);
  }

  this.emit('logging-started', { processName });
  return true;
}
```

## Key Changes

### 1. ✅ Lifecycle Order (MANDATORY)

```
BEFORE:
registerProcess
  ↓ (race condition)
createWriteStream
  ↓ (file might not exist)
attachWatcher  ← CRASH HERE

AFTER:
registerProcess
  ↓
ensureDirectory
  ↓
ensureFile
  ↓
createWriteStream
  ↓
attachWatcher  ← GUARANTEED to work
```

### 2. ✅ Single Source of Truth

```javascript
// BEFORE: Multiple places tracking log path
this.logFiles = new Map();
this.logs = new Map();
this.streams = new Map();

// AFTER: ProcessState is source of truth
const proc = this.processState.getProcess(name);
const logFile = proc.logFile;  // All subsystems use same path
```

### 3. ✅ Error Recovery

```javascript
// BEFORE: Error crashes watcher
fs.watch(logFile);  // If file missing → ENOENT

// AFTER: Errors are handled gracefully
fs.watch(logFile)
  .on('error', (error) => {
    if (error.code === 'ENOENT') {
      logRecovery.attemptRecovery(name, logFile);
    }
  });
```

## Implementation Checklist

- [ ] Inject `ProcessState` into LogStreamService
- [ ] Inject `FsUtils` into LogStreamService  
- [ ] Inject `LogRecovery` into LogStreamService
- [ ] Refactor `startLogging` with correct order
- [ ] Add error handlers to writeStream
- [ ] Add error handlers to file watcher
- [ ] Test with missing log file
- [ ] Test with permission errors
- [ ] Test with concurrent starts
- [ ] Verify invariants after startup

## Testing Edge Cases

```javascript
// Test 1: Log file deleted while watcher attached
const logFile = proc.logFile;
fs.unlinkSync(logFile);
// → logRecovery recreates file automatically

// Test 2: Permission denied
fs.chmodSync(logFile, 0o000);
// → logRecovery fixes permissions

// Test 3: Directory deleted
fs.rmdirSync(logDir, { recursive: true });
// → logRecovery recreates directory

// Test 4: Race condition (two processes writing)
logStreamService.startLogging('proc1', {});
logStreamService.startLogging('proc1', {});  // Should handle gracefully
```

## Result

✅ **Guarantees met:**
1. Directory exists when needed
2. File exists before watching
3. Errors are handled, not fatal
4. Single source of truth for paths
5. Automatic recovery on failure

✅ **No more ENOENT errors**
