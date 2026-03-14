const cron = require('node-cron');
const fs = require('fs-extra');
const path = require('path');
const Plugin = require('../../src/Plugin.js');

/**
 * Auto Backup Plugin for ANCHOR
 * Automatically creates backups of game server data
 */
class AutoBackupPlugin extends Plugin {
  constructor(options) {
    super(options);
    this.name = 'anchor-auto-backup';
    this.version = '1.0.0';
    this.description = 'Automatic backup plugin for ANCHOR game servers';

    // Events this plugin listens to
    this.events = [
      'serverCreated',
      'serverStop'
    ];

    this.backupTasks = new Map(); // serverId -> cron task
    this.backupDir = null;
  }

  async init(api) {
    await super.init(api);

    // Get configuration
    this.backupDir = this.getConfig('backupDir', './backups');
    const schedule = this.getConfig('schedule', '0 */6 * * *'); // Every 6 hours
    const maxBackups = this.getConfig('maxBackups', 10);

    this.api.info(`Auto backup initialized - Schedule: ${schedule}, Max backups: ${maxBackups}`);

    // Ensure backup directory exists
    try {
      await fs.ensureDir(this.backupDir);
      this.api.info(`Backup directory: ${this.backupDir}`);
    } catch (error) {
      this.api.error(`Failed to create backup directory: ${error.message}`);
      return;
    }

    // Schedule backups for existing servers
    await this.scheduleExistingServers(schedule);
  }

  async destroy() {
    // Stop all backup tasks
    for (const [serverId, task] of this.backupTasks) {
      task.stop();
      this.api.info(`Stopped backup task for ${serverId}`);
    }
    this.backupTasks.clear();

    await super.destroy();
  }

  onEvent(event, data) {
    switch (event) {
      case 'serverCreated':
        this.onServerCreated(data);
        break;
      case 'serverStop':
        this.onServerStop(data);
        break;
    }
  }

  onServerCreated(data) {
    const schedule = this.getConfig('schedule', '0 */6 * * *');

    // Schedule backups for the new server
    this.scheduleBackup(data.serverId, schedule);
  }

  onServerStop(data) {
    // Create a final backup when server stops
    this.createBackup(data.serverId, 'shutdown');
  }

  async scheduleExistingServers(schedule) {
    const servers = await this.api.getServers();
    for (const serverId of Object.keys(servers)) {
      this.scheduleBackup(serverId, schedule);
    }
  }

  scheduleBackup(serverId, schedule) {
    if (this.backupTasks.has(serverId)) {
      this.backupTasks.get(serverId).stop();
    }

    const task = cron.schedule(schedule, async () => {
      await this.createBackup(serverId, 'scheduled');
    });

    this.backupTasks.set(serverId, task);
    this.api.info(`Scheduled backups for ${serverId} with cron: ${schedule}`);
  }

  async createBackup(serverId, reason) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = `${serverId}_${timestamp}_${reason}`;
      const backupPath = path.join(this.backupDir, backupName);

      // For demo purposes, we'll create a simple backup structure
      // In a real implementation, this would copy actual game server data
      await fs.ensureDir(backupPath);

      // Create backup metadata
      const metadata = {
        serverId,
        timestamp: new Date().toISOString(),
        reason,
        version: this.version,
        serverInfo: await this.getServerInfo(serverId)
      };

      await fs.writeJson(path.join(backupPath, 'backup.json'), metadata);

      // Create a sample data file
      const sampleData = {
        message: `Backup of ${serverId} created at ${new Date().toISOString()}`,
        reason,
        serverId
      };
      await fs.writeJson(path.join(backupPath, 'data.json'), sampleData);

      this.api.info(`✅ Created backup: ${backupName}`);

      // Clean up old backups
      await this.cleanupOldBackups(serverId);

      // Emit backup event for other plugins
      this.api.emit('backupCreated', {
        serverId,
        backupName,
        backupPath,
        reason,
        timestamp: metadata.timestamp
      });

    } catch (error) {
      this.api.error(`❌ Failed to create backup for ${serverId}: ${error.message}`);
    }
  }

  async cleanupOldBackups(serverId) {
    try {
      const maxBackups = this.getConfig('maxBackups', 10);
      const serverBackupDir = this.backupDir;

      // Get all backups for this server
      const files = await fs.readdir(serverBackupDir);
      const serverBackups = files
        .filter(file => file.startsWith(`${serverId}_`))
        .sort()
        .reverse(); // Most recent first

      // Remove old backups
      if (serverBackups.length > maxBackups) {
        const toDelete = serverBackups.slice(maxBackups);
        for (const backup of toDelete) {
          const backupPath = path.join(serverBackupDir, backup);
          await fs.remove(backupPath);
          this.api.info(`🗑️ Removed old backup: ${backup}`);
        }
      }
    } catch (error) {
      this.api.error(`Failed to cleanup old backups for ${serverId}: ${error.message}`);
    }
  }

  async getServerInfo(serverId) {
    const servers = await this.api.getServers();
    return servers[serverId] || null;
  }

  // Manual backup method that can be called by other plugins or API
  async manualBackup(serverId, reason = 'manual') {
    await this.createBackup(serverId, reason);
  }
}

module.exports = AutoBackupPlugin;
