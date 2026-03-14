const EventEmitter = require('events');
const logger = require('./Logger.js');

/**
 * ScalingEngine - AI-powered auto-scaling for ANCHOR clusters
 * Analyzes metrics and makes intelligent scaling decisions
 */
class ScalingEngine extends EventEmitter {
  constructor(clusterManager, gameServerManager, options = {}) {
    super();
    this.cluster = clusterManager;
    this.gameServerManager = gameServerManager;
    this.options = {
      checkInterval: options.checkInterval || 30000, // 30 seconds
      scaleUpThreshold: options.scaleUpThreshold || 0.8, // 80% capacity
      scaleDownThreshold: options.scaleDownThreshold || 0.2, // 20% capacity
      idleTimeout: options.idleTimeout || 1200000, // 20 minutes
      predictiveEnabled: options.predictiveEnabled || true,
      ...options
    };

    this.metrics = new Map(); // serverId -> metrics history
    this.scalingHistory = [];
    this.patterns = new Map(); // Learn usage patterns
    this.interval = null;
  }

  /**
   * Start the scaling engine
   */
  start() {
    logger.info('🚀 Starting AI Scaling Engine');
    this.interval = setInterval(() => this.checkScaling(), this.options.checkInterval);
    this.emit('started');
  }

  /**
   * Stop the scaling engine
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('🛑 Stopped AI Scaling Engine');
    this.emit('stopped');
  }

  /**
   * Record metrics for a server
   */
  recordMetrics(serverId, metrics) {
    if (!this.metrics.has(serverId)) {
      this.metrics.set(serverId, []);
    }

    const history = this.metrics.get(serverId);
    history.push({
      timestamp: Date.now(),
      ...metrics
    });

    // Keep only last 100 data points
    if (history.length > 100) {
      history.shift();
    }

    // Learn patterns for predictive scaling
    if (this.options.predictiveEnabled) {
      this.learnPatterns(serverId, metrics);
    }
  }

  /**
   * Learn usage patterns for predictive scaling
   */
  learnPatterns(serverId, metrics) {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    const key = `${serverId}-${day}-${hour}`;

    if (!this.patterns.has(key)) {
      this.patterns.set(key, []);
    }

    this.patterns.get(key).push(metrics);

    // Keep only last 10 samples per time slot
    if (this.patterns.get(key).length > 10) {
      this.patterns.get(key).shift();
    }
  }

  /**
   * Get predictive scaling recommendation
   */
  getPredictiveScaling(serverId) {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    // Look ahead 1 hour
    const futureHour = (hour + 1) % 24;
    const key = `${serverId}-${day}-${futureHour}`;

    const patternData = this.patterns.get(key);
    if (!patternData || patternData.length < 3) {
      return null; // Not enough data
    }

    // Calculate average load for this time slot
    const avgLoad = patternData.reduce((sum, m) => sum + (m.players || 0), 0) / patternData.length;
    const avgCapacity = patternData.reduce((sum, m) => sum + (m.maxPlayers || 20), 0) / patternData.length;

    const predictedUtilization = avgLoad / avgCapacity;

    return {
      predictedLoad: avgLoad,
      predictedUtilization,
      confidence: Math.min(patternData.length / 10, 1), // 0-1 confidence
      timeSlot: `${day}-${futureHour}`
    };
  }

  /**
   * Main scaling check loop
   */
  async checkScaling() {
    try {
      const servers = await this.getAllServers();
      const nodes = this.cluster.getNodes();

      for (const server of servers) {
        await this.evaluateServerScaling(server, nodes);
      }

      // Check for predictive scaling
      if (this.options.predictiveEnabled) {
        await this.checkPredictiveScaling(servers, nodes);
      }

      // Cost optimization - shutdown idle servers
      await this.optimizeCosts(servers);

    } catch (error) {
      logger.error(`ScalingEngine: Error in scaling check: ${error.message}`);
    }
  }

  /**
   * Evaluate scaling for a specific server
   */
  async evaluateServerScaling(server, nodes) {
    const metrics = this.getLatestMetrics(server.id);
    if (!metrics) return;

    const utilization = metrics.players / metrics.maxPlayers;

    // Scale up if over threshold
    if (utilization > this.options.scaleUpThreshold) {
      logger.info(`ScalingEngine: ${server.id} utilization ${utilization.toFixed(2)} > ${this.options.scaleUpThreshold}, scaling up`);
      await this.scaleUp(server, nodes);
    }

    // Scale down if under threshold (but not too aggressively)
    else if (utilization < this.options.scaleDownThreshold && this.canScaleDown(server)) {
      logger.info(`ScalingEngine: ${server.id} utilization ${utilization.toFixed(2)} < ${this.options.scaleDownThreshold}, considering scale down`);
      // Only scale down if we have multiple servers of same type
      const similarServers = await this.getSimilarServers(server);
      if (similarServers.length > 1) {
        await this.scaleDown(server);
      }
    }
  }

  /**
   * Check predictive scaling opportunities
   */
  async checkPredictiveScaling(servers, nodes) {
    for (const server of servers) {
      const prediction = this.getPredictiveScaling(server.id);
      if (!prediction) continue;

      if (prediction.predictedUtilization > this.options.scaleUpThreshold &&
          prediction.confidence > 0.7) {
        logger.info(`ScalingEngine: Predictive scaling - ${server.id} expected utilization ${prediction.predictedUtilization.toFixed(2)} in 1 hour`);
        await this.predictiveScaleUp(server, nodes, prediction);
      }
    }
  }

  /**
   * Cost optimization - shutdown idle servers
   */
  async optimizeCosts(servers) {
    const now = Date.now();

    for (const server of servers) {
      const metrics = this.getLatestMetrics(server.id);
      if (!metrics) continue;

      // Server is idle
      if (metrics.players === 0) {
        const idleTime = now - (metrics.timestamp || 0);

        if (idleTime > this.options.idleTimeout) {
          // Check if this is the last server of its type
          const similarServers = await this.getSimilarServers(server);
          if (similarServers.length > 1) {
            logger.info(`ScalingEngine: Cost optimization - shutting down idle server ${server.id} (idle ${Math.round(idleTime/60000)}min)`);
            await this.shutdownIdleServer(server);
          }
        }
      }
    }
  }

  /**
   * Scale up by creating a new server
   */
  async scaleUp(server, nodes) {
    try {
      // Find best node for new server
      const targetNode = this.selectScalingNode(server.region, nodes);
      if (!targetNode) {
        logger.warn(`ScalingEngine: No suitable node found for scaling up ${server.id}`);
        return;
      }

      // Create new server in same region
      const newServerName = `${server.type}-scale-${Date.now()}`;

      await this.cluster.deployToNode(targetNode.nodeId, newServerName, server.image, {
        name: newServerName,
        ...server.options
      });

      this.scalingHistory.push({
        action: 'scale_up',
        serverId: server.id,
        newServerId: newServerName,
        nodeId: targetNode.nodeId,
        timestamp: Date.now(),
        reason: 'utilization_threshold'
      });

      this.emit('scaled_up', { originalServer: server.id, newServer: newServerName, node: targetNode });

    } catch (error) {
      logger.error(`ScalingEngine: Failed to scale up ${server.id}: ${error.message}`);
    }
  }

  /**
   * Predictive scale up
   */
  async predictiveScaleUp(server, nodes, prediction) {
    try {
      const targetNode = this.selectScalingNode(server.region, nodes);
      if (!targetNode) return;

      const newServerName = `${server.type}-predictive-${Date.now()}`;

      await this.cluster.deployToNode(targetNode.nodeId, newServerName, server.image, {
        name: newServerName,
        ...server.options
      });

      this.scalingHistory.push({
        action: 'predictive_scale_up',
        serverId: server.id,
        newServerId: newServerName,
        nodeId: targetNode.nodeId,
        timestamp: Date.now(),
        prediction
      });

      this.emit('predictive_scaled_up', { server: server.id, newServer: newServerName, prediction });

    } catch (error) {
      logger.error(`ScalingEngine: Failed predictive scale up: ${error.message}`);
    }
  }

  /**
   * Scale down by removing a server
   */
  async scaleDown(server) {
    try {
      await this.cluster.removeServer(server.id);

      this.scalingHistory.push({
        action: 'scale_down',
        serverId: server.id,
        timestamp: Date.now(),
        reason: 'low_utilization'
      });

      this.emit('scaled_down', { serverId: server.id });

    } catch (error) {
      logger.error(`ScalingEngine: Failed to scale down ${server.id}: ${error.message}`);
    }
  }

  /**
   * Shutdown idle server for cost optimization
   */
  async shutdownIdleServer(server) {
    try {
      await this.cluster.removeServer(server.id);

      this.scalingHistory.push({
        action: 'cost_optimization',
        serverId: server.id,
        timestamp: Date.now(),
        reason: 'idle_timeout'
      });

      this.emit('cost_optimized', { serverId: server.id });

    } catch (error) {
      logger.error(`ScalingEngine: Failed to shutdown idle server ${server.id}: ${error.message}`);
    }
  }

  /**
   * Select best node for scaling
   */
  selectScalingNode(region, nodes) {
    const availableNodes = Array.from(nodes.values())
      .filter(node => node.status === 'online')
      .filter(node => !region || node.region === region);

    if (!availableNodes.length) return null;

    // Select node with most available memory
    return availableNodes.reduce((best, current) =>
      current.capacity.memory.free > best.capacity.memory.free ? current : best
    );
  }

  /**
   * Check if server can be scaled down
   */
  canScaleDown(server) {
    // Don't scale down if server was recently created
    const createdRecently = Date.now() - server.createdAt < 300000; // 5 minutes
    return !createdRecently;
  }

  /**
   * Get latest metrics for a server
   */
  getLatestMetrics(serverId) {
    const history = this.metrics.get(serverId);
    return history && history.length > 0 ? history[history.length - 1] : null;
  }

  /**
   * Get all servers (from game server manager)
   */
  async getAllServers() {
    if (!this.gameServerManager) return [];
    try {
      const servers = await this.gameServerManager.listServersWithStatus();
      return servers.map(server => ({
        id: server.name,
        type: server.type,
        status: server.status,
        players: server.players || 0,
        maxPlayers: server.maxPlayers || 20,
        region: server.region || 'default',
        image: server.image,
        options: server.options || {},
        createdAt: server.createdAt || Date.now()
      }));
    } catch (error) {
      logger.error(`ScalingEngine: Error getting servers: ${error.message}`);
      return [];
    }
  }

  /**
   * Get servers of similar type
   */
  async getSimilarServers(server) {
    const allServers = await this.getAllServers();
    return allServers.filter(s => s.type === server.type && s.status === 'running');
  }

  /**
   * Remove a server (for scaling down)
   */
  async removeServer(serverId) {
    if (!this.gameServerManager) return;
    try {
      await this.gameServerManager.stopServer(serverId, true); // Force stop
      logger.info(`ScalingEngine: Removed server ${serverId}`);
    } catch (error) {
      logger.error(`ScalingEngine: Error removing server ${serverId}: ${error.message}`);
    }
  }
  getStats() {
    const now = Date.now();
    const last24h = now - 86400000;

    const recentScaling = this.scalingHistory.filter(s => s.timestamp > last24h);

    return {
      totalScalingActions: this.scalingHistory.length,
      scalingActions24h: recentScaling.length,
      scaleUpActions: recentScaling.filter(s => s.action.includes('scale_up')).length,
      scaleDownActions: recentScaling.filter(s => s.action.includes('scale_down')).length,
      costOptimizations: recentScaling.filter(s => s.action === 'cost_optimization').length,
      predictiveScalings: recentScaling.filter(s => s.action.includes('predictive')).length,
      activeMetrics: this.metrics.size,
      learnedPatterns: this.patterns.size
    };
  }
}

module.exports = ScalingEngine;