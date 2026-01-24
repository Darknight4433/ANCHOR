const DaemonService = require('../bin/daemon.js');
const PersistenceManager = require('../src/PersistenceManager.js');
const ConfigManager = require('../src/ConfigManager.js');

/**
 * Infrastructure example - Demonstrates daemon, persistence, and recovery
 */

async function demonstrateInfrastructure() {
  console.log('🏗️ Process Manager Infrastructure Example\n');

  // Example 1: Configuration Management
  console.log('--- Example 1: Configuration Management ---');
  const configManager = new ConfigManager();
  const config = configManager.load();
  console.log('Loaded config with settings:');
  console.log(`  - Auto-restart: ${config.processes.autoRestart}`);
  console.log(`  - Graceful shutdown timeout: ${config.processes.gracefulShutdownTimeout}ms`);
  console.log(`  - Persistence enabled: ${config.persistence.enabled}`);
  console.log(`  - Save interval: ${config.persistence.saveInterval}ms`);
  console.log();

  // Example 2: Persistence Manager
  console.log('--- Example 2: Persistence Manager ---');
  const persistence = new PersistenceManager();
  const stats = persistence.getStats();
  console.log('Persistence stats:');
  console.log(`  - Data directory: ${stats.dataDir}`);
  console.log(`  - Tracked processes: ${stats.processCount}`);
  console.log(`  - Daemon running: ${stats.daemonRunning}`);
  console.log(`  - Daemon PID: ${stats.daemonPID}`);
  console.log();

  // Example 3: Config Validation
  console.log('--- Example 3: Configuration Validation ---');
  const validation = configManager.validate();
  if (validation.valid) {
    console.log('✓ Configuration is valid');
  } else {
    console.log('✗ Configuration errors:');
    validation.errors.forEach(err => console.log(`  - ${err}`));
  }
  console.log();

  // Example 4: State Persistence
  console.log('--- Example 4: State Persistence ---');
  const mockProcesses = new Map([
    ['web-server', {
      name: 'web-server',
      command: 'node',
      args: ['server.js'],
      cwd: '/opt/app',
      autoStart: true,
      restarts: 3
    }],
    ['worker-1', {
      name: 'worker-1',
      command: 'node',
      args: ['worker.js'],
      cwd: '/opt/app',
      autoStart: true,
      restarts: 1
    }]
  ]);

  console.log('Saving process state...');
  persistence.saveState(mockProcesses);
  console.log('✓ Saved 2 processes to state file');

  // Load it back
  const loadedState = persistence.loadState();
  console.log(`✓ Loaded ${loadedState.processes.length} processes from state`);
  loadedState.processes.forEach(p => {
    console.log(`  - ${p.name} (auto-start: ${p.autoStart}, restarts: ${p.restarts})`);
  });
  console.log();

  // Example 5: Daemon Simulation
  console.log('--- Example 5: Daemon Service Initialization ---');
  console.log('(This would start the background service)');
  console.log('Key capabilities:');
  console.log('  ✓ Recovers processes on startup');
  console.log('  ✓ Saves state periodically');
  console.log('  ✓ Handles graceful shutdown');
  console.log('  ✓ Auto-restarts failed processes');
  console.log('  ✓ Communicates via Unix socket');
  console.log();

  // Example 6: systemd Integration
  console.log('--- Example 6: systemd Integration ---');
  console.log('Service file features:');
  console.log('  ✓ Automatic restart policy: always');
  console.log('  ✓ Restart delay: 10 seconds');
  console.log('  ✓ Security hardening enabled');
  console.log('  ✓ Logs to systemd journal');
  console.log('  ✓ Starts after network is available');
  console.log();

  // Example 7: Boot Recovery Flow
  console.log('--- Example 7: Boot Recovery Flow ---');
  console.log('On system startup:');
  console.log('  1. systemd launches process-manager service');
  console.log('  2. Daemon reads config from /etc/process-manager/config.yaml');
  console.log('  3. Daemon loads persisted state from ~/.process-manager/state.json');
  console.log('  4. For each process with autoStart=true:');
  console.log('     a. Daemon spawns the process');
  console.log('     b. Tracks PID and uptime');
  console.log('     c. Sets up restart handlers');
  console.log('  5. Daemon listens on Unix socket for commands');
  console.log('  6. State is saved periodically every 10s');
  console.log();

  // Example 8: Usage Commands
  console.log('--- Example 8: Common Commands ---');
  console.log('Start daemon as system service:');
  console.log('  sudo systemctl start process-manager');
  console.log('');
  console.log('Enable daemon on boot:');
  console.log('  sudo systemctl enable process-manager');
  console.log('');
  console.log('Check status:');
  console.log('  sudo systemctl status process-manager');
  console.log('');
  console.log('View logs:');
  console.log('  sudo journalctl -u process-manager -f');
  console.log('');
  console.log('Stop daemon:');
  console.log('  sudo systemctl stop process-manager');
  console.log();

  console.log('✅ Infrastructure example complete!');
  console.log('\nThis setup provides:');
  console.log('  🔄 Persistence across reboots');
  console.log('  🚀 Background service capability');
  console.log('  ⚙️  systemd integration');
  console.log('  📋 Configuration management');
  console.log('  🔒 Automatic recovery');
  console.log('  📊 Process tracking');
}

demonstrateInfrastructure().catch(console.error);
