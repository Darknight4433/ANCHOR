const EventEmitter = require('events');
const logger = require('./Logger.js');

/**
 * GlobalLoadBalancer - Routes players to optimal game servers
 * Considers latency, server load, capacity, and regional preferences
 */
class GlobalLoadBalancer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      latencyCheckInterval: options.latencyCheckInterval || 30000, // 30 seconds
      maxLatencyHistory: options.maxLatencyHistory || 10,
      regionPriority: options.regionPriority || 'latency', // 'latency', 'load', 'capacity'
      enableGeoRouting: options.enableGeoRouting !== false,
      enableMultiCloud: options.enableMultiCloud || true,
      ...options
    };

    this.regions = new Map(); // regionId -> region info
    this.servers = new Map(); // serverId -> server info with latency data
    this.latencyHistory = new Map(); // regionId -> latency measurements
    this.clientLatencies = new Map(); // clientId -> measured latencies
    this.routingHistory = []; // Array of routing decisions
    this.cloudProviderManager = options.cloudProviderManager || null; // Multi-cloud support
    this.crossCloudRouting = new Map(); // Track cross-cloud routes
    this.interval = null;
  }

  /**
   * Add a region to the load balancer
   */
  addRegion(regionId, config) {
    this.regions.set(regionId, {
      id: regionId,
      name: config.name || regionId,
      location: config.location || 'unknown',
      endpoint: config.endpoint, // For latency testing
      priority: config.priority || 1,
      ...config
    });

    this.latencyHistory.set(regionId, []);
    logger.info(`🌐 Added region: ${regionId} (${config.name || regionId})`);
  }

  /**
   * Remove a region
   */
  removeRegion(regionId) {
    this.regions.delete(regionId);
    this.latencyHistory.delete(regionId);
    logger.info(`🌐 Removed region: ${regionId}`);
  }

  /**
   * Register a game server with the load balancer
   */
  registerServer(serverId, serverInfo) {
    this.servers.set(serverId, {
      id: serverId,
      region: serverInfo.region || 'default',
      address: serverInfo.address,
      port: serverInfo.port,
      players: serverInfo.players || 0,
      maxPlayers: serverInfo.maxPlayers || 20,
      load: serverInfo.load || 0, // 0-1 scale
      status: serverInfo.status || 'unknown',
      gameType: serverInfo.gameType || 'unknown',
      ...serverInfo
    });

    logger.info(`🎮 Registered server: ${serverId} in region ${serverInfo.region || 'default'}`);
    this.emit('serverRegistered', { serverId, serverInfo });
  }

  /**
   * Update server information
   */
  updateServer(serverId, updates) {
    const server = this.servers.get(serverId);
    if (server) {
      Object.assign(server, updates);
      this.emit('serverUpdated', { serverId, updates });
    }
  }

  /**
   * Unregister a server
   */
  unregisterServer(serverId) {
    this.servers.delete(serverId);
    logger.info(`🎮 Unregistered server: ${serverId}`);
    this.emit('serverUnregistered', { serverId });
  }

  /**
   * Start the load balancer
   */
  start() {
    logger.info('🌐 Starting Global Load Balancer');
    this.interval = setInterval(() => this.measureLatencies(), this.options.latencyCheckInterval);
    this.emit('started');
  }

  /**
   * Stop the load balancer
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('🌐 Stopped Global Load Balancer');
    this.emit('stopped');
  }

  /**
   * Measure latency to all regions
   */
  async measureLatencies() {
    for (const [regionId, region] of this.regions) {
      if (region.endpoint) {
        try {
          const latency = await this.measureLatency(region.endpoint);
          this.recordLatency(regionId, latency);
        } catch (error) {
          logger.warn(`Failed to measure latency to ${regionId}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Measure latency to an endpoint (simplified - in real implementation would use actual ping)
   */
  async measureLatency(endpoint) {
    // Simulate latency measurement
    // In a real implementation, this would:
    // 1. Send ICMP ping packets
    // 2. Use WebSocket/TCP connection time
    // 3. Use HTTP HEAD requests

    // For demo purposes, simulate realistic latencies
    const baseLatencies = {
      'us-east': 20,
      'us-west': 50,
      'us-central': 35,
      'eu-west': 80,
      'eu-central': 70,
      'ap-east': 150,
      'ap-southeast': 120,
      'sa-east': 100
    };

    const baseLatency = baseLatencies[endpoint] || 50;

    // Add some jitter (±20ms)
    const jitter = (Math.random() - 0.5) * 40;
    const measured = Math.max(10, baseLatency + jitter);

    return Math.round(measured);
  }

  /**
   * Record latency measurement
   */
  recordLatency(regionId, latency) {
    const history = this.latencyHistory.get(regionId) || [];
    history.push({
      timestamp: Date.now(),
      latency
    });

    // Keep only recent measurements
    if (history.length > this.options.maxLatencyHistory) {
      history.shift();
    }

    this.latencyHistory.set(regionId, history);
  }

  /**
   * Get average latency for a region
   */
  getAverageLatency(regionId) {
    const history = this.latencyHistory.get(regionId);
    if (!history || history.length === 0) return Infinity;

    const sum = history.reduce((acc, measurement) => acc + measurement.latency, 0);
    return sum / history.length;
  }

  /**
   * Find the best server for a client based on routing strategy
   */
  findBestServer(clientInfo = {}) {
    const availableServers = Array.from(this.servers.values())
      .filter(server => server.status === 'running')
      .filter(server => server.players < server.maxPlayers);

    if (availableServers.length === 0) {
      return null;
    }

    // Score each server based on routing strategy
    const scoredServers = availableServers.map(server => ({
      server,
      score: this.calculateServerScore(server, clientInfo)
    }));

    // Sort by score (higher is better)
    scoredServers.sort((a, b) => b.score - a.score);

    const bestServer = scoredServers[0].server;
    logger.info(`🌐 Best server for client: ${bestServer.id} (score: ${scoredServers[0].score.toFixed(2)})`);

    return bestServer;
  }

  /**
   * Calculate routing score for a server
   */
  calculateServerScore(server, clientInfo) {
    let score = 0;

    switch (this.options.regionPriority) {
      case 'latency': {
        // Prefer low latency regions
        const regionLatency = this.getAverageLatency(server.region);
        score += Math.max(0, 100 - regionLatency); // Higher score for lower latency
        break;
      }

      case 'load':
        // Prefer less loaded servers
        score += 100 * (1 - server.load); // Higher score for lower load
        break;

      case 'capacity': {
        // Prefer servers with more available capacity
        const utilization = server.players / server.maxPlayers;
        score += 100 * (1 - utilization); // Higher score for lower utilization
        break;
      }

      default: {
        // Balanced approach
        const latency = this.getAverageLatency(server.region);
        const utilizationDefault = server.players / server.maxPlayers;
        score += (100 - latency) * 0.5; // 50% weight on latency
        score += 100 * (1 - utilizationDefault) * 0.3; // 30% weight on capacity
        score += 100 * (1 - server.load) * 0.2; // 20% weight on load
      }
    }

    // Boost score for preferred regions (if client has region preference)
    if (clientInfo.preferredRegion && server.region === clientInfo.preferredRegion) {
      score += 50;
    }

    // Boost score for game type match
    if (clientInfo.gameType && server.gameType === clientInfo.gameType) {
      score += 25;
    }

    return score;
  }

  /**
   * Get routing statistics
   */
  getStats() {
    const servers = Array.from(this.servers.values());
    const totalServers = servers.length;
    const totalCapacity = servers.reduce((sum, server) => sum + server.maxPlayers, 0);
    const totalLoad = servers.reduce((sum, server) => sum + server.players, 0);
    const averageUtilization = totalCapacity > 0 ? (totalLoad / totalCapacity) * 100 : 0;

    // Calculate region stats
    const regionStats = {};
    // eslint-disable-next-line no-unused-vars
    for (const [regionName, region] of this.regions) {
      const regionServers = servers.filter(s => s.region === regionName);
      if (regionServers.length > 0) {
        const avgLatency = this.getAverageLatency(regionName);
        regionStats[regionName] = {
          serverCount: regionServers.length,
          averageLatency: avgLatency,
          totalCapacity: regionServers.reduce((sum, s) => sum + s.maxPlayers, 0),
          totalLoad: regionServers.reduce((sum, s) => sum + s.players, 0)
        };
      }
    }

    // Find best performing region (lowest average latency)
    let bestRegion = null;
    let bestLatency = Infinity;
    for (const [regionName, stats] of Object.entries(regionStats)) {
      if (stats.averageLatency < bestLatency) {
        bestLatency = stats.averageLatency;
        bestRegion = regionName;
      }
    }

    return {
      totalServers,
      totalCapacity,
      totalLoad,
      averageUtilization,
      averageLatency: this.getAverageLatency(),
      bestRegion,
      regions: regionStats,
      routingStats: {
        totalRoutes: this.routingHistory.length,
        successfulRoutes: this.routingHistory.filter(r => r.success).length,
        failedRoutes: this.routingHistory.filter(r => !r.success).length
      }
    };
  }

  /**
   * Simulate player connection and return best server
   */
  routePlayer(clientInfo = {}) {
    const bestServer = this.findBestServer(clientInfo);

    if (bestServer) {
      // Record the routing decision
      this.emit('playerRouted', {
        clientInfo,
        serverId: bestServer.id,
        region: bestServer.region,
        latency: this.getAverageLatency(bestServer.region),
        timestamp: Date.now()
      });

      return {
        server: bestServer,
        connectionInfo: {
          address: bestServer.address,
          port: bestServer.port,
          region: bestServer.region,
          estimatedLatency: Math.round(this.getAverageLatency(bestServer.region))
        }
      };
    }

    return null;
  }

  /**
   * Update server load
   */
  updateServerLoad(serverId, newLoad) {
    const server = this.servers.get(serverId);
    if (server) {
      server.players = newLoad;
      server.load = server.maxPlayers > 0 ? newLoad / server.maxPlayers : 0;
      this.emit('serverLoadUpdated', { serverId, newLoad });
    }
  }

  /**
   * Get all regions
   */
  getRegions() {
    return Array.from(this.regions.values());
  }

  /**
   * Get all servers
   */
  getServers() {
    return Array.from(this.servers.values());
  }

  /**
   * Set cloud provider manager for multi-cloud support
   */
  setCloudProviderManager(cloudProviderManager) {
    this.cloudProviderManager = cloudProviderManager;
    logger.info('🌐 Cloud Provider Manager integrated with Global Load Balancer');
  }

  /**
   * Multi-cloud: Route across multiple cloud providers
   */
  routePlayerMultiCloud(clientInfo = {}) {
    if (!this.options.enableMultiCloud || !this.cloudProviderManager) {
      // Fall back to traditional routing
      return this.routePlayer(clientInfo);
    }

    // Get optimal region considering cost and latency
    const optimalRegions = this.cloudProviderManager.getOptimalRegion({
      sourceRegion: clientInfo.preferredRegion,
      weightCost: 0.3,
      weightLatency: 0.5,
      weightAvailability: 0.2
    });

    if (!optimalRegions || optimalRegions.length === 0) {
      return this.routePlayer(clientInfo); // Fallback to local routing
    }

    // Try to find server in optimal regions (in preference order)
    for (const { region } of optimalRegions) {
      const regionServers = Array.from(this.servers.values())
        .filter(s => s.region === region && s.status === 'running' && s.players < s.maxPlayers);

      if (regionServers.length > 0) {
        // Get best server in this region
        const bestServer = regionServers.reduce((best, current) => {
          const bestScore = this.calculateServerScore(best, clientInfo);
          const currentScore = this.calculateServerScore(current, clientInfo);
          return currentScore > bestScore ? current : best;
        });

        this.crossCloudRouting.set(clientInfo.clientId || `route-${Date.now()}`, {
          cloud: 'multi-cloud',
          sourceRegion: clientInfo.preferredRegion,
          targetRegion: region,
          serverId: bestServer.id,
          timestamp: Date.now()
        });

        logger.info(`🌐 Multi-cloud route: ${bestServer.id} in ${region}`);
        this.emit('multiCloudRoute', {
          clientInfo,
          serverId: bestServer.id,
          region,
          cloud: 'multi-cloud'
        });

        return {
          server: bestServer,
          connectionInfo: {
            address: bestServer.address,
            port: bestServer.port,
            region: bestServer.region,
            cloud: 'multi-cloud',
            estimatedLatency: Math.round(this.getAverageLatency(bestServer.region))
          }
        };
      }
    }

    // No optimal regions available, use any available server
    return this.routePlayer(clientInfo);
  }

  /**
   * Get cross-cloud routing statistics
   */
  getCrossCloudStats() {
    if (!this.cloudProviderManager) {
      return { error: 'Cloud provider manager not initialized' };
    }

    const stats = this.cloudProviderManager.getDashboardStats();
    return {
      ...stats,
      crossCloudRoutes: this.crossCloudRouting.size,
      routingHistory: Array.from(this.crossCloudRouting.values()).slice(-10)
    };
  }

  /**
   * Check cloud provider health and failover if needed
   */
  async checkCloudHealth() {
    if (!this.cloudProviderManager || !this.options.enableMultiCloud) {
      return;
    }

    try {
      const stats = this.cloudProviderManager.getDashboardStats();

      // Check for unhealthy instances
      const unhealthyInstances = stats.instanceHealth.filter(inst => inst.health !== 'healthy');

      for (const unhealthyInst of unhealthyInstances) {
        logger.warn(`🌐 Detected unhealthy cloud instance: ${unhealthyInst.id}`);

        // Attempt failover
        try {
          await this.cloudProviderManager.failoverInstance(
            unhealthyInst.id,
            this.options.preferredFailoverRegion
          );
        } catch (error) {
          logger.error(`Failed to failover instance: ${error.message}`);
        }
      }
    } catch (error) {
      logger.error(`Cloud health check failed: ${error.message}`);
    }
  }

  /**
   * Optimize deployment across clouds based on cost
   */
  recommendOptimalDeployment(requirements = {}) {
    if (!this.cloudProviderManager) {
      return null;
    }

    const optimalRegions = this.cloudProviderManager.getOptimalRegion({
      sourceRegion: requirements.sourceRegion,
      weightCost: requirements.allowHighCost ? 0.2 : 0.5,
      weightLatency: 0.3,
      weightAvailability: 0.2
    });

    if (!optimalRegions) {
      return null;
    }

    return {
      recommendations: optimalRegions.map(rec => ({
        region: rec.region,
        score: rec.score,
        expectedCost: Math.round(rec.score * requirements.expectedLoad * 1000) / 100
      })),
      estimatedTotalCost: this.cloudProviderManager.getTotalCost()
    };
  }
}

module.exports = GlobalLoadBalancer;