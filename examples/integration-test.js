#!/usr/bin/env node

const ProcessManager = require('../src/index.js');
const DaemonService = require('../bin/daemon.js');
const PersistenceManager = require('../src/PersistenceManager.js');
const ConfigManager = require('../src/ConfigManager.js');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/**
 * Integration tests for infrastructure features
 */

async function runIntegrationTests() {
  console.log('🧪 Running Infrastructure Integration Tests\n');

  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Config Manager
  try {
    console.log('Test 1: Configuration Management');
    const configManager = new ConfigManager();
    const config = configManager.load();
    
    assert(config.daemon !== undefined, 'Config should have daemon section');
    assert(config.processes !== undefined, 'Config should have processes section');
    assert(config.persistence !== undefined, 'Config should have persistence section');
    
    const validation = configManager.validate();
    assert(validation.valid === true, 'Default config should be valid');
    
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  // Test 2: Config dot notation get/set
  try {
    console.log('Test 2: Configuration Get/Set with Dot Notation');
    const configManager = new ConfigManager();
    configManager.load();
    
    const port = configManager.get('daemon.port');
    assert(Number.isInteger(port), 'Port should be an integer');
    
    configManager.set('daemon.port', 9999);
    assert(configManager.get('daemon.port') === 9999, 'Port should be updated');
    
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  // Test 3: Persistence Manager - State Save/Load
  try {
    console.log('Test 3: Persistence - State Save and Load');
    const persistence = new PersistenceManager();
    
    const testProcesses = new Map([
      ['test-proc-1', { name: 'test-proc-1', command: 'node', args: ['test.js'], autoStart: true }],
      ['test-proc-2', { name: 'test-proc-2', command: 'bash', args: ['script.sh'], autoStart: false }]
    ]);
    
    persistence.saveState(testProcesses);
    const loaded = persistence.loadState();
    
    assert(loaded.processes.length === 2, 'Should load 2 processes');
    assert(loaded.processes[0].name === 'test-proc-1', 'First process name should match');
    assert(loaded.processes[1].autoStart === false, 'Second process autoStart should be false');
    
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  // Test 4: Persistence Manager - PID Management
  try {
    console.log('Test 4: Persistence - PID Management');
    const persistence = new PersistenceManager();
    
    const testPID = 12345;
    persistence.savePID(testPID);
    
    const loaded = persistence.loadPID();
    assert(loaded === testPID, 'Saved PID should match loaded PID');
    
    persistence.clearPID();
    const cleared = persistence.loadPID();
    assert(cleared === null, 'PID should be null after clearing');
    
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  // Test 5: Persistence Manager - Stats
  try {
    console.log('Test 5: Persistence - Get Stats');
    const persistence = new PersistenceManager();
    const stats = persistence.getStats();
    
    assert(stats.dataDir !== undefined, 'Stats should have dataDir');
    assert(Number.isInteger(stats.processCount), 'Stats should have processCount');
    assert(typeof stats.daemonRunning === 'boolean', 'Stats should have daemonRunning');
    
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  // Test 6: Config File Save
  try {
    console.log('Test 6: Configuration - File Save');
    const configPath = path.join(__dirname, '../.test-config.yaml');
    const configManager = new ConfigManager(configPath);
    configManager.createDefault();
    
    assert(fs.existsSync(configPath), 'Config file should be created');
    
    // Clean up
    fs.unlinkSync(configPath);
    
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  // Test 7: Persistence Directory Structure
  try {
    console.log('Test 7: Persistence - Data Directory Structure');
    const persistence = new PersistenceManager();
    const dataDir = persistence.getDataDirectory();
    
    assert(fs.existsSync(dataDir), 'Data directory should exist');
    
    const socketPath = persistence.getSocketPath();
    assert(socketPath.includes('.process-manager'), 'Socket path should be in .process-manager');
    
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  // Test 8: Config Validation - Invalid Values
  try {
    console.log('Test 8: Configuration - Validation with Invalid Values');
    const configManager = new ConfigManager();
    configManager.config = {
      daemon: { port: 99999 }, // Invalid port
      processes: { restartDelay: -1 } // Invalid delay
    };
    
    const validation = configManager.validate();
    assert(validation.valid === false, 'Invalid config should fail validation');
    assert(validation.errors.length > 0, 'Should have error messages');
    
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  // Test 9: Daemon Service Initialization (non-running)
  try {
    console.log('Test 9: Daemon Service Initialization');
    const daemon = new DaemonService();
    
    assert(daemon.pm !== undefined, 'Daemon should have ProcessManager');
    assert(daemon.persistenceManager !== undefined, 'Daemon should have PersistenceManager');
    assert(daemon.configManager !== undefined, 'Daemon should have ConfigManager');
    
    const status = daemon.getStatus();
    assert(status.dataDir !== undefined, 'Daemon status should have dataDir');
    
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  // Test 10: Process State Recovery Simulation
  try {
    console.log('Test 10: Process Recovery from Persisted State');
    const persistence = new PersistenceManager();
    
    // Save some process configs
    const processes = new Map([
      ['web-1', { 
        name: 'web-1', 
        command: 'node', 
        args: ['server.js'],
        autoStart: true,
        restarts: 5
      }]
    ]);
    
    persistence.saveState(processes);
    
    // Load them back
    const state = persistence.loadState();
    const recovered = state.processes[0];
    
    assert(recovered.name === 'web-1', 'Process name should match');
    assert(recovered.autoStart === true, 'autoStart should be true');
    assert(recovered.restarts === 5, 'Restart count should be preserved');
    
    console.log('✓ PASSED\n');
    testsPassed++;
  } catch (error) {
    console.log('✗ FAILED:', error.message, '\n');
    testsFailed++;
  }

  // Summary
  console.log('━'.repeat(50));
  console.log(`Tests Passed: ${testsPassed}`);
  console.log(`Tests Failed: ${testsFailed}`);
  console.log(`Total Tests: ${testsPassed + testsFailed}`);
  console.log('━'.repeat(50));

  if (testsFailed === 0) {
    console.log('\n✅ All infrastructure tests passed!');
    console.log('\n🚀 Ready for production deployment:');
    console.log('  1. Install systemd service: sudo npm run install-service');
    console.log('  2. Enable on boot: sudo systemctl enable process-manager');
    console.log('  3. Start service: sudo systemctl start process-manager');
    process.exit(0);
  } else {
    console.log('\n✗ Some tests failed');
    process.exit(1);
  }
}

runIntegrationTests().catch(console.error);
