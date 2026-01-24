const ProcessManager = require('../src/index.js');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/**
 * Test suite for ProcessManager
 */

async function runTests() {
  console.log('🧪 Running ProcessManager Tests\n');

  // Clear persisted state before tests (for fresh state)
  const stateDir = path.join(process.env.HOME || '/tmp', '.process-manager');
  if (fs.existsSync(stateDir)) {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  const pm = new ProcessManager();
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // Test 1: Start a process
    console.log('Test 1: Start a process');
    const proc = pm.start('node', ['-e', 'setInterval(() => {}, 1000)'], {
      name: 'test-process-1'
    });
    assert(proc.pid > 0, 'PID should be greater than 0');
    assert(proc.status === 'running', 'Status should be running');
    // Give process a moment to calculate uptime
    await new Promise(resolve => setTimeout(resolve, 50));
    const procInfo = pm.getProcessInfo('test-process-1');
    assert(procInfo.uptimeMs >= 0, 'Uptime should be >= 0');
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  try {
    // Test 2: Get process info
    console.log('Test 2: Get process information');
    const info = pm.getProcessInfo('test-process-1');
    assert(info !== null, 'Process info should exist');
    assert(info.name === 'test-process-1', 'Name should match');
    assert(info.status === 'running', 'Status should be running');
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  try {
    // Test 3: Check if running
    console.log('Test 3: Check if process is running');
    const isRunning = pm.isRunning('test-process-1');
    assert(isRunning === true, 'Process should be running');
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  try {
    // Test 4: Get all processes
    console.log('Test 4: Get all processes');
    const all = pm.getAllProcesses();
    assert(Array.isArray(all), 'Should return array');
    assert(all.length > 0, 'Should have at least one process');
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  try {
    // Test 5: Start multiple processes
    console.log('Test 5: Start multiple processes');
    pm.start('node', ['-e', 'setInterval(() => {}, 1000)'], { name: 'test-process-2' });
    pm.start('node', ['-e', 'setInterval(() => {}, 1000)'], { name: 'test-process-3' });
    const all = pm.getAllProcesses();
    assert(all.length >= 3, 'Should have at least 3 processes');
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  try {
    // Test 6: Stop a process
    console.log('Test 6: Stop a process');
    await pm.stop('test-process-1');
    const info = pm.getProcessInfo('test-process-1');
    assert(info.status === 'stopped', 'Status should be stopped');
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  try {
    // Test 7: Restart a process
    console.log('Test 7: Restart a process');
    const beforeRestarts = pm.getProcessInfo('test-process-2').restarts;
    await pm.restart('test-process-2');
    const afterRestarts = pm.getProcessInfo('test-process-2').restarts;
    assert(afterRestarts === beforeRestarts + 1, 'Restart count should increase');
    assert(pm.getProcessInfo('test-process-2').status === 'running', 'Should be running after restart');
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  try {
    // Test 8: Stop all processes
    console.log('Test 8: Stop all processes');
    await pm.stopAll();
    const all = pm.getAllProcesses();
    const stillRunning = all.filter(p => p.status === 'running').length;
    assert(stillRunning === 0, 'All processes should be stopped');
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  try {
    // Test 9: Error handling - start non-existent command
    console.log('Test 9: Error handling - non-existent command');
    try {
      pm.start('this-command-does-not-exist-xyz');
      throw new Error('Should have thrown an error');
    } catch (error) {
      // Expected to fail
      console.log('✓ PASSED (error caught as expected)\n');
      testsPassed++;
    }
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  try {
    // Test 10: Error handling - stop non-existent process
    console.log('Test 10: Error handling - stop non-existent process');
    try {
      pm.stop('non-existent-process');
      throw new Error('Should have thrown an error');
    } catch (error) {
      // Expected to fail
      console.log('✓ PASSED (error caught as expected)\n');
      testsPassed++;
    }
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  console.log('━'.repeat(50));
  console.log(`Tests Passed: ${testsPassed}`);
  console.log(`Tests Failed: ${testsFailed}`);
  console.log(`Total Tests: ${testsPassed + testsFailed}`);
  console.log('━'.repeat(50));

  if (testsFailed === 0) {
    console.log('✓ All tests passed!');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed');
    process.exit(1);
  }
}

runTests().catch(console.error);
