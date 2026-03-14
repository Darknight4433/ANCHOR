const Plugin = require('../../src/Plugin.js');

/**
 * Analytics Plugin for ANCHOR
 * Collects and analyzes server performance and usage data
 */
class AnalyticsPlugin extends Plugin {
  constructor(options) {
    super(options);
    this.name = 'anchor-analytics';
    this.version = '1.0.0';
    this.description = 'Analytics and monitoring plugin for ANCHOR';

    // Events this plugin listens to
    this.events = [
      'serverCreated',
      'serverStart',
      'serverStop',
      'scalingUp',
      'scalingDown',
      'costOptimization',
      'backupCreated'
    ];

    this.analytics = {
      serverStats: new Map(),
      scalingEvents: [],
      costSavings: 0,
      totalUptime: 0,
      peakConcurrentPlayers: 0
    };

    this.collectionInterval = null;
  }

  async init(api) {
    await super.init(api);

    const collectionInterval = this.getConfig('collectionInterval', 60000); // 1 minute

    this.api.info(`Analytics initialized - Collection interval: ${collectionInterval}ms`);

    // Start data collection
    this.collectionInterval = setInterval(() => {
      this.collectMetrics();
    }, collectionInterval);

    // Initialize analytics data
    this.analytics.startTime = Date.now();
  }

  async destroy() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
    }
    await super.destroy();
  }

  onEvent(event, data) {
    const timestamp = Date.now();

    switch (event) {
      case 'serverCreated':
        this.trackServerCreation(data, timestamp);
        break;
      case 'serverStart':
        this.trackServerStart(data, timestamp);
        break;
      case 'serverStop':
        this.trackServerStop(data, timestamp);
        break;
      case 'scalingUp':
        this.trackScalingEvent('up', data, timestamp);
        break;
      case 'scalingDown':
        this.trackScalingEvent('down', data, timestamp);
        break;
      case 'costOptimization':
        this.trackCostOptimization(data);
        break;
      case 'backupCreated':
        this.trackBackupEvent(data);
        break;
    }
  }

  trackServerCreation(data, timestamp) {
    if (!this.analytics.serverStats.has(data.serverId)) {
      this.analytics.serverStats.set(data.serverId, {
        createdAt: timestamp,
        type: data.type,
        region: data.region,
        startCount: 0,
        stopCount: 0,
        totalUptime: 0,
        lastStartTime: null,
        scalingEvents: 0,
        backups: 0
      });
    }

    this.api.info(`📊 Analytics: Server ${data.serverId} created (${data.type})`);
  }

  trackServerStart(data, timestamp) {
    const stats = this.analytics.serverStats.get(data.serverId);
    if (stats) {
      stats.startCount++;
      stats.lastStartTime = timestamp;
    }
  }

  trackServerStop(data, timestamp) {
    const stats = this.analytics.serverStats.get(data.serverId);
    if (stats && stats.lastStartTime) {
      const uptime = timestamp - stats.lastStartTime;
      stats.totalUptime += uptime;
      this.analytics.totalUptime += uptime;
      stats.lastStartTime = null;
    }
  }

  trackScalingEvent(direction, data, timestamp) {
    this.analytics.scalingEvents.push({
      direction,
      serverId: data.serverId || data.originalServer,
      timestamp,
      type: direction === 'up' ? 'scale_up' : 'scale_down'
    });

    const stats = this.analytics.serverStats.get(data.serverId || data.originalServer);
    if (stats) {
      stats.scalingEvents++;
    }

    this.api.info(`📊 Analytics: Scaling ${direction} for ${data.serverId || data.originalServer}`);
  }

  trackCostOptimization(data) {
    // Estimate cost savings (example: $0.10 per hour per server)
    const hourlyRate = this.getConfig('hourlyRate', 0.10);
    this.analytics.costSavings += hourlyRate;

    this.api.info(`📊 Analytics: Cost optimization saved $${hourlyRate.toFixed(2)} for ${data.serverId}`);
  }

  trackBackupEvent(data) {
    const stats = this.analytics.serverStats.get(data.serverId);
    if (stats) {
      stats.backups++;
    }

    this.api.info(`📊 Analytics: Backup created for ${data.serverId}`);
  }

  async collectMetrics() {
    try {
      const servers = await this.api.getServers();
      let totalPlayers = 0;

      // eslint-disable-next-line no-unused-vars
      for (const [_serverId, server] of Object.entries(servers)) {
        if (server.status === 'running') {
          totalPlayers += server.players || 0;
        }
      }

      // Track peak concurrent players
      if (totalPlayers > this.analytics.peakConcurrentPlayers) {
        this.analytics.peakConcurrentPlayers = totalPlayers;
      }

      // Update server stats with current metrics
      for (const [serverId, server] of Object.entries(servers)) {
        const stats = this.analytics.serverStats.get(serverId);
        if (stats) {
          stats.currentPlayers = server.players || 0;
          stats.status = server.status;
        }
      }

    } catch (error) {
      this.api.error(`Analytics metric collection failed: ${error.message}`);
    }
  }

  getAnalytics() {
    const now = Date.now();
    const runtime = now - this.analytics.startTime;

    return {
      runtime: Math.floor(runtime / 1000), // seconds
      totalServers: this.analytics.serverStats.size,
      activeServers: Array.from(this.analytics.serverStats.values())
        .filter(s => s.status === 'running').length,
      totalScalingEvents: this.analytics.scalingEvents.length,
      scalingUpEvents: this.analytics.scalingEvents.filter(e => e.direction === 'up').length,
      scalingDownEvents: this.analytics.scalingEvents.filter(e => e.direction === 'down').length,
      totalUptime: Math.floor(this.analytics.totalUptime / 1000), // seconds
      costSavings: this.analytics.costSavings.toFixed(2),
      peakConcurrentPlayers: this.analytics.peakConcurrentPlayers,
      serverBreakdown: this.getServerBreakdown(),
      recentScalingEvents: this.analytics.scalingEvents.slice(-10) // Last 10 events
    };
  }

  getServerBreakdown() {
    const breakdown = {};
    for (const [serverId, stats] of this.analytics.serverStats) {
      breakdown[serverId] = {
        type: stats.type,
        region: stats.region,
        startCount: stats.startCount,
        stopCount: stats.stopCount,
        totalUptime: Math.floor(stats.totalUptime / 1000),
        scalingEvents: stats.scalingEvents,
        backups: stats.backups,
        currentPlayers: stats.currentPlayers || 0,
        status: stats.status
      };
    }
    return breakdown;
  }

  // Method that can be called by API or other plugins
  generateReport() {
    const analytics = this.getAnalytics();

    return {
      title: 'ANCHOR Analytics Report',
      generatedAt: new Date().toISOString(),
      summary: {
        totalRuntime: `${Math.floor(analytics.runtime / 3600)}h ${Math.floor((analytics.runtime % 3600) / 60)}m`,
        totalServers: analytics.totalServers,
        activeServers: analytics.activeServers,
        totalScalingEvents: analytics.totalScalingEvents,
        costSavings: `$${analytics.costSavings}`,
        peakPlayers: analytics.peakConcurrentPlayers
      },
      details: analytics
    };
  }
}

module.exports = AnalyticsPlugin;