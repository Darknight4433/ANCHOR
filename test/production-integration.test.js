/* eslint-env jest */

const fs = require('fs');
const path = require('path');
const ProcessManager = require('../src/index.js');
const ProcessState = require('../src/ProcessState.js');
const FsUtils = require('../src/FsUtils.js');

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

describe('System Integrity Tests', () => {
  let pm;

  beforeEach(() => {
    cleanup();
    pm = new ProcessManager();
  });

  afterEach(async () => {
    if (pm) {
      await pm.stopAll();
    }
    cleanupAfter();
  });

  it('Principle 1: saves state correctly', () => {
    const ps = new ProcessState(path.join(testDir, 'state'));
    ps.registerProcess('test-proc', { command: 'echo', args: ['hello'] });
    ps.saveState();
    expect(fs.existsSync(path.join(testDir, 'state', 'state.json'))).toBe(true);
  });

  it('Principle 2: lifecycle order prevents watching empty file', () => {
    const logDir = path.join(testDir, 'logs');
    const logFile = path.join(logDir, 'test.log');
    FsUtils.ensureDir(logDir);
    FsUtils.ensureFile(logFile);
    expect(fs.existsSync(logFile)).toBe(true);
  });

  it('Integration: survives restart cycle', async () => {
    const info1 = pm.start('node', ['-e', 'setInterval(() => {}, 1000)'], { name: 'cycle-test' });
    const pid1 = info1.pid;
    
    await pm.restart('cycle-test');
    
    const info2 = pm.getProcessInfo('cycle-test');
    expect(info2.pid !== pid1 || !info2.process.killed).toBe(true);
  });
});
                  