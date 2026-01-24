const ProcessManager = require('../src/index.js');

/**
 * Example usage of the ProcessManager
 */

const pm = new ProcessManager();

// Setup event listeners
pm.on('start', ({ name, pid }) => {
  console.log(`✓ Started: ${name} (PID: ${pid})`);
});

pm.on('stop', ({ name, pid }) => {
  console.log(`✓ Stopped: ${name} (PID: ${pid})`);
});

pm.on('restart', ({ name, restarts }) => {
  console.log(`✓ Restarted: ${name} (Total restarts: ${restarts})`);
});

pm.on('exit', ({ name, code, signal }) => {
  console.log(`✓ Exited: ${name} (Exit code: ${code})`);
});

pm.on('error', ({ name, error }) => {
  console.error(`✗ Error in ${name}:`, error.message);
});

async function main() {
  console.log('🚀 ProcessManager Example\n');

  // Example 1: Start a simple process
  console.log('--- Example 1: Starting a simple process ---');
  const proc1 = pm.start('node', ['-e', 'console.log("Hello from process"); setInterval(() => {}, 1000)'], {
    name: 'hello-process',
    stdio: 'inherit'
  });
  console.log('Process Info:', proc1);
  console.log();

  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Example 2: Get process info
  console.log('--- Example 2: Get process information ---');
  const info = pm.getProcessInfo('hello-process');
  console.log('Current Info:', info);
  console.log();

  // Example 3: List all processes
  console.log('--- Example 3: List all processes ---');
  const all = pm.getAllProcesses();
  console.log('All Processes:');
  console.table(all);
  console.log();

  // Example 4: Check if running
  console.log('--- Example 4: Check if process is running ---');
  console.log('Is running:', pm.isRunning('hello-process'));
  console.log();

  // Example 5: Start another process
  console.log('--- Example 5: Start another process ---');
  const proc2 = pm.start('node', ['-e', 'console.log("Second process"); setInterval(() => {}, 1000)'], {
    name: 'second-process',
    stdio: 'inherit'
  });
  console.log('Process Info:', proc2);
  console.log();

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Example 6: List all again
  console.log('--- Example 6: List all processes again ---');
  const allAgain = pm.getAllProcesses();
  console.log('All Processes:');
  console.table(allAgain);
  console.log();

  // Example 7: Stop a process
  console.log('--- Example 7: Stop a process ---');
  await pm.stop('hello-process');
  console.log();

  // Example 8: Restart a process
  console.log('--- Example 8: Restart a process ---');
  await pm.restart('second-process');
  console.log();

  // Example 9: Get updated info
  console.log('--- Example 9: Get updated info after restart ---');
  const updatedInfo = pm.getProcessInfo('second-process');
  console.log('Updated Info:', updatedInfo);
  console.log();

  // Example 10: Stop all
  console.log('--- Example 10: Stop all processes ---');
  await pm.stopAll();
  console.log('All processes stopped');
  console.log();

  console.log('✓ Example complete!');
}

main().catch(console.error);
