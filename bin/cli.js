#!/usr/bin/env node

const ProcessManager = require('../src/index.js');
const DaemonService = require('./daemon.js');
const DaemonClient = require('./daemon-client.js');
const PersistenceManager = require('../src/PersistenceManager.js');
const ConfigManager = require('../src/ConfigManager.js');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

let pm = new ProcessManager();
let useDaemon = false;
let daemonClient = null;

// Event listeners
pm.on('start', ({ name, pid }) => console.log(`✓ Started: ${name} (PID: ${pid})`));
pm.on('stop', ({ name, pid }) => console.log(`✓ Stopped: ${name} (PID: ${pid})`));
pm.on('restart', ({ name, restarts }) => console.log(`✓ Restarted: ${name} (restarts: ${restarts})`));
pm.on('error', ({ name, error }) => console.error(`✗ Error in ${name}:`, error.message));
pm.on('exit', ({ name, code, signal }) => console.log(`✓ Exited: ${name} (code: ${code}, signal: ${signal})`));

const commands = {
  'daemon-start': 'daemon-start [config] - Start daemon service',
  'daemon-stop': 'daemon-stop - Stop daemon service',
  'daemon-status': 'daemon-status - Show daemon status',
  'daemon-config': 'daemon-config [path] - Show or set config',
  start: 'start <command> [args...] - Start a process',
  stop: 'stop <name> - Stop a process',
  restart: 'restart <name> - Restart a process',
  list: 'list - List all processes',
  info: 'info <name> - Get process information',
  help: 'help - Show available commands',
  exit: 'exit - Exit the CLI'
};

function showHelp() {
  console.log('\nAvailable Commands:');
  Object.values(commands).forEach(cmd => console.log(`  ${cmd}`));
  console.log();
}

function handleCommand(input) {
  const parts = input.trim().split(/\s+/);
  const [cmd, ...args] = parts;

  switch (cmd.toLowerCase()) {
    case 'daemon-start': {
      console.log('Starting daemon service...');
      const configPath = args[0];
      const daemon = new DaemonService(configPath);
      daemon.start()
        .then(() => {
          console.log('✓ Daemon started successfully');
          console.log(`Data directory: ${daemon.persistenceManager.getDataDirectory()}`);
        })
        .catch((error) => {
          console.error('✗ Failed to start daemon:', error.message);
        });
      break;
    }

    case 'daemon-stop': {
      const persistence = new PersistenceManager();
      const daemonPID = persistence.loadPID();
      
      if (!daemonPID) {
        console.error('✗ Daemon is not running');
        return;
      }

      try {
        process.kill(daemonPID, 'SIGTERM');
        console.log('✓ Sent shutdown signal to daemon');
      } catch (error) {
        console.error('✗ Error:', error.message);
      }
      break;
    }

    case 'daemon-status': {
      try {
        const client = new DaemonClient();
        client.status()
          .then((result) => {
            if (result.success) {
              console.log('\n📊 Daemon Status:');
              console.table(result.data);
              if (result.data.processes && result.data.processes.length > 0) {
                console.log('\nManaged Processes:');
                console.table(result.data.processes);
              }
            } else {
              console.error('✗ Error:', result.error);
            }
          })
          .catch((error) => {
            console.error('✗ Error:', error.message);
          });
      } catch (error) {
        console.error('✗ Error:', error.message);
      }
      break;
    }

    case 'daemon-config': {
      try {
        const configPath = args[0];
        const configManager = new ConfigManager(configPath);
        
        if (args.length === 0) {
          // Show current config
          const config = configManager.load();
          console.log('\n⚙️ Current Configuration:');
          console.log(JSON.stringify(config, null, 2));
        } else if (args[1]) {
          // Set value
          configManager.load();
          configManager.set(args[0], JSON.parse(args[1]));
          configManager.save();
          console.log(`✓ Set ${args[0]} = ${args[1]}`);
        } else {
          // Create default config
          configManager.createDefault();
          console.log(`✓ Created default config at: ${configPath || configManager.configPath}`);
        }
      } catch (error) {
        console.error('✗ Error:', error.message);
      }
      break;
    }

    case 'start': {
      if (args.length < 1) {
        console.error('Usage: start <command> [args...]');
        return;
      }
      const [command, ...cmdArgs] = args;
      const name = `${command}-${Date.now()}`;
      try {
        const info = pm.start(command, cmdArgs, { name });
        console.log('\nProcess Info:');
        console.table(info);
      } catch (error) {
        console.error('Error:', error.message);
      }
      break;
    }

    case 'stop': {
      if (args.length < 1) {
        console.error('Usage: stop <name>');
        return;
      }
      try {
        pm.stop(args[0]).then(() => {
          console.log(`\nProcess stopped: ${args[0]}`);
        });
      } catch (error) {
        console.error('Error:', error.message);
      }
      break;
    }

    case 'restart': {
      if (args.length < 1) {
        console.error('Usage: restart <name>');
        return;
      }
      try {
        pm.restart(args[0]).then((info) => {
          console.log(`\nProcess restarted: ${args[0]}`);
          console.table(info);
        });
      } catch (error) {
        console.error('Error:', error.message);
      }
      break;
    }

    case 'list': {
      const processes = pm.getAllProcesses();
      if (processes.length === 0) {
        console.log('No processes running');
      } else {
        console.log('\nProcesses:');
        console.table(processes);
      }
      break;
    }

    case 'info': {
      if (args.length < 1) {
        console.error('Usage: info <name>');
        return;
      }
      const info = pm.getProcessInfo(args[0]);
      if (!info) {
        console.error(`Process "${args[0]}" not found`);
      } else {
        console.log('\nProcess Info:');
        console.table(info);
      }
      break;
    }

    case 'help':
      showHelp();
      break;

    case 'exit':
      pm.stopAll().then(() => {
        console.log('Goodbye!');
        process.exit(0);
      });
      return;

    default:
      console.error(`Unknown command: ${cmd}`);
      console.log('Type "help" for available commands');
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🚀 Process Manager CLI');
showHelp();

rl.on('line', (input) => {
  if (input.trim()) {
    handleCommand(input);
  }
  rl.prompt();
});

rl.setPrompt('pm> ');
rl.prompt();

// Handle cleanup
process.on('SIGINT', () => {
  pm.stopAll().then(() => {
    console.log('\nShutdown complete');
    process.exit(0);
  });
});
