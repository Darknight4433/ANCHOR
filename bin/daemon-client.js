#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const path = require('path');
const PersistenceManager = require('../src/PersistenceManager.js');

/**
 * CLI Client - Communicates with daemon service
 */
class DaemonClient {
  constructor() {
    this.persistence = new PersistenceManager();
  }

  /**
   * Send command to daemon
   */
  sendCommand(command) {
    return new Promise((resolve, reject) => {
      const socketPath = this.persistence.getSocketPath();

      if (!this.persistence.isDaemonRunning()) {
        reject(new Error('Daemon is not running. Start it with: daemon start'));
        return;
      }

      const socket = net.createConnection(socketPath);
      let response = '';

      socket.on('connect', () => {
        socket.write(JSON.stringify(command) + '\n');
      });

      socket.on('data', (data) => {
        response += data.toString();
      });

      socket.on('end', () => {
        try {
          resolve(JSON.parse(response));
        } catch (e) {
          reject(new Error(`Invalid response from daemon: ${response}`));
        }
      });

      socket.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        socket.destroy();
        reject(new Error('Daemon command timeout'));
      }, 5000);
    });
  }

  /**
   * Start a process
   */
  async start(command, args, options = {}) {
    const [cmd, ...cmdArgs] = command.split(' ').filter(x => x);
    return this.sendCommand({
      action: 'start',
      name: options.name || `${cmd}-${Date.now()}`,
      args: [cmd, ...cmdArgs, ...args],
      options
    });
  }

  /**
   * Stop a process
   */
  async stop(name) {
    return this.sendCommand({
      action: 'stop',
      name
    });
  }

  /**
   * Restart a process
   */
  async restart(name) {
    return this.sendCommand({
      action: 'restart',
      name
    });
  }

  /**
   * List all processes
   */
  async list() {
    return this.sendCommand({
      action: 'list'
    });
  }

  /**
   * Get process info
   */
  async info(name) {
    return this.sendCommand({
      action: 'info',
      name
    });
  }

  /**
   * Get daemon status
   */
  async status() {
    return this.sendCommand({
      action: 'status'
    });
  }
}

module.exports = DaemonClient;
