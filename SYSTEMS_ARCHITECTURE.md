# 🏗️ ANCHOR - Systems Architecture (Following 9 Principles)

## 📊 Before vs. After

### Memory State (❌ Old)
```
ProcessManager → in-memory Map
LogStreamService → in-memory Map  
GameServerManager → in-memory Map
```
**Problem:** Crashes lose everything; race conditions

### Single Source of Truth (✅ New)
```
ProcessState → ~/.process-manager/state.json
  ├── processes/
  │   ├── proc1.json
  │   └── proc2.json
  └── logs/
      ├── proc1/
      │   └── proc1-2026-01-24.log
      └── proc2/
          └── proc2-2026-01-24.log
```
**Benefit:** Recoverable; consistent; queryable

---

## 🔄 Lifecycle: Before vs. After

### ❌ BEFORE (Broken)
```
startProcess()
  ↓
attachWatcher()  ← Assumes log file exists
  ↓ CRASH: ENOENT
```

### ✅ AFTER (Fixed)
```
ensureDir(logDir)
  ↓
ensureFile(logFile)
  ↓
createWriteStream()
  ↓
recordProcessStart()
  ↓
attachWatcher()  ← File guaranteed to exist
  ↓
attachLogCapture()
```

**Key:** Dependencies ordered correctly

---

## 📦 New Module Structure

### ProcessState.js (NEW)
- **Responsibility:** Single source of truth
- **Exports:** registerProcess, recordStart, recordStop, getProcess, saveState
- **Invariants:** 
  - status ∈ {registered, starting, running, stopped}
  - pid null when stopped
  - logFile set when running
- **Guarantee:** Atomic writes, schema validation

### LifecycleValidator.js (NEW)
- **Responsibility:** Enforce ordering
- **Exports:** checkDirectoryReady, checkLogFileReady, checkProcessRegistered
- **Prevents:** File operations before files exist

### FsUtils.js (NEW)
- **Responsibility:** Guaranteed file operations
- **Exports:** ensureDir, ensureFile, atomicWrite, safeAppend
- **Guarantee:** Never partial writes, always recovery

### LogRecovery.js (NEW)
- **Responsibility:** Handle logging failures gracefully
- **Exports:** attemptRecovery, withRecovery, handleWatcherError
- **Behavior:** ENOENT → recreate file, EACCES → fix permissions

### LogStreamService.js (REFACTORED)
- **Responsibility:** Log capture + streaming ONLY
- **Uses:** ProcessState, FsUtils, LogRecovery
- **Before:** Managed state + files + watching
- **After:** Only manages log streams + recovery

### ProcessManager.js (REFACTORED)
- **Responsibility:** Process lifecycle ONLY
- **Uses:** ProcessState, LifecycleValidator
- **Before:** Tracked state internally
- **After:** Delegates state to ProcessState

---

## 🛡️ Guarantees by Layer

### Layer 1: ProcessState
```
✅ State persisted to disk
✅ State atomically updated
✅ State validated on read
✅ Crash recovery available
✅ Invariants enforced
```

### Layer 2: File System
```
✅ Directories pre-exist
✅ Files pre-exist
✅ Permissions correct
✅ Partial writes prevented
✅ Atomic operations
```

### Layer 3: Processes
```
✅ Start sequence correct
✅ Stop sequence correct
✅ Restart tracking
✅ PID tracking
✅ Log association
```

### Layer 4: Logging
```
✅ Log file exists before watcher
✅ Missing files recreated
✅ Permissions fixed
✅ Disk full handled
✅ Errors are NOT fatal
```

---

## 🧪 Test Coverage

### New Tests Required

```javascript
// ProcessState tests
✅ registerProcess creates state
✅ recordProcessStart sets logFile
✅ recordProcessStop clears pid
✅ verifyInvariants catches corruption
✅ recoverAfterCrash marks dead processes

// FsUtils tests
✅ ensureDir creates recursive
✅ ensureFile creates if missing
✅ atomicWrite handles rename
✅ isSafePath prevents traversal

// LifecycleValidator tests
✅ checkLogFileReady throws if missing
✅ checkProcessRegistered throws if missing

// LogRecovery tests
✅ handleWatcherError on ENOENT
✅ attemptRecovery max attempts
✅ withRecovery retries operation

// LogStreamService tests (refactored)
✅ startLogging creates file first
✅ missing file recovered gracefully
✅ concurrent startLogging handled
✅ watcher error recovered
```

---

## 🚀 Deployment Advantages

### 1. Crash Recovery
```
Before: Crash → lose all state → manual restart
After:  Crash → reload from state.json → auto-resume
```

### 2. Process Recovery
```
Before: Process dies → unknown → stuck
After:  Process dies → state marked crashed → can retry
```

### 3. Auditing
```
Before: No record of what happened
After:  state.json timestamp shows all changes
```

### 4. Scaling
```
Before: Can't replicate state
After:  state.json can sync to other nodes
```

### 5. Debugging
```
Before: "Process seems stuck" → guess
After:  cat state.json → see exact status
```

---

## 📋 Migration Path (Non-Breaking)

### Phase 1: Add New Modules (No Changes)
- ✅ Add ProcessState
- ✅ Add FsUtils
- ✅ Add LifecycleValidator
- ✅ Add LogRecovery
- ✅ Tests for new modules

### Phase 2: Refactor Incrementally
- Refactor LogStreamService to use FsUtils
- Refactor ProcessManager to use LifecycleValidator
- Refactor all file ops to use LogRecovery

### Phase 3: Migrate State
- Gradually move process state to ProcessState
- Keep fallback to memory for compatibility
- Add migration script

### Phase 4: Full Integration
- All subsystems use ProcessState
- Remove memory-based state
- Enable crash recovery

---

## ✅ Success Metrics

After implementing these principles:

```
✅ No ENOENT errors
✅ Graceful degradation on file errors
✅ State survives crashes
✅ Single source of truth for all data
✅ Clear lifecycle ordering
✅ Testable file operations
✅ Recoverable from common failures
✅ Production-ready error handling
```

---

## 🎯 Next Steps

1. **Integrate ProcessState into ProcessManager**
   - Start: register with ProcessState
   - Track: update ProcessState on changes
   - Stop: record exit in ProcessState

2. **Integrate FsUtils into LogStreamService**
   - Replace all fs.* calls with FsUtils
   - Guarantee directories before logs

3. **Add LogRecovery error handlers**
   - Wrap writeStream operations
   - Handle watcher errors

4. **Add tests for edge cases**
   - Missing files
   - Permission errors
   - Race conditions

5. **Document invariants**
   - What ProcessState guarantees
   - What can be assumed true
   - What can cause violations

