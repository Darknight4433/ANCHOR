const EventEmitter = require('events');
const logger = require('./Logger.js');

/**
 * MultiRegionOrchestrator - Handles cross-region deployments and state synchronization
 * Manages automated failover, data replication, and distributed orchestration
 */
class MultiRegionOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      syncInterval: options.syncInterval || 30000, // 30 seconds
      replicationFactor: options.replicationFactor || 2, // Number of replicas
      maxFailoverTime: options.maxFailoverTime || 60000, // 1 minute
      enableAutoFailover: options.enableAutoFailover !== false,
      healthCheckInterval: options.healthCheckInterval || 10000, // 10 seconds
      ...options
    };

    this.regions = new Map(); // regionId -> region config
    this.deployments = new Map(); // deploymentId -> deployment state
    this.replicationGroups = new Map(); // groupId -> list of replica deployments
    this.failoverRules = new Map(); // regionId -> failover rules
    this.syncLog = []; // Log of sync operations
    this.healthStatus = new Map(); // regionId -> health status
    this.interval = null;
    this.healthCheckInterval = null;
  }

  /**
   * Register a region for multi-region orchestration
   */
  registerRegion(regionId, config) {
    const region = {
      id: regionId,
      name: config.name || regionId,
      location: config.location || 'unknown',
      cloudProvider: config.cloudProvider, // 'aws', 'gcp', 'azure'
      replicationTargets: config.replicationTargets || [], // Other regions to replicate to
      priority: config.priority || 1, // Higher = primary region
      currentLoad: 0,
      deploymentCount: 0,
      lastSync: null,
      health: 'healthy',
      ...config
    };

    this.regions.set(regionId, region);
    this.healthStatus.set(regionId, 'healthy');

    logger.info(`🌍 Registered region: ${regionId} (${config.cloudProvider})`);
    this.emit('regionRegistered', { regionId, region });
  }

  /**
   * Deploy application across multiple regions
   */
  async deployDistributed(appId, appConfig) {
    const replicationFactor = appConfig.replicationFactor || this.options.replicationFactor;
    const targetRegions = this.selectOptimalRegions(appConfig.preferredRegions, replicationFactor);

    if (targetRegions.length < replicationFactor) {
      throw new Error(`Not enough regions available. Required: ${replicationFactor}, Available: ${targetRegions.length}`);
    }

    const deploymentId = `deploy-${appId}-${Date.now()}`;
    const replicas = [];

    // Deploy to primary region first
    const primaryRegion = targetRegions[0];
    const primaryDeployment = await this.deployToRegion(deploymentId, 'primary', primaryRegion, appConfig);
    replicas.push(primaryDeployment);

    // Deploy to secondary regions
    for (let i = 1; i < targetRegions.length; i++) {
      const secondaryDeployment = await this.deployToRegion(
        deploymentId,
        `secondary-${i}`,
        targetRegions[i],
        appConfig
      );
      replicas.push(secondaryDeployment);
    }

    // Store replication group
    this.replicationGroups.set(deploymentId, replicas);

    logger.info(`🌍 Distributed deployment: ${deploymentId} across ${targetRegions.length} regions`);
    this.emit('distributedDeployment', { deploymentId, replicas, regions: targetRegions });

    return {
      deploymentId,
      replicas,
      deploymentTime: Date.now(),
      replicationFactor: targetRegions.length
    };
  }

  /**
   * Deploy to a specific region
   */
  async deployToRegion(deploymentId, role, regionId, appConfig) {
    const region = this.regions.get(regionId);
    if (!region) {
      throw new Error(`Region not found: ${regionId}`);
    }

    const deployment = {
      id: `${deploymentId}-${regionId}`,
      deploymentId,
      role,
      regionId,
      cloudProvider: region.cloudProvider,
      appConfig,
      status: 'deploying',
      createdAt: Date.now(),
      dataVersion: 0,
      lastSyncTime: Date.now(),
      syncStatus: 'in-sync'
    };

    this.deployments.set(deployment.id, deployment);
    region.deploymentCount++;

    logger.info(`🚀 Deploying ${role} in ${regionId}: ${deployment.id}`);

    // Simulate deployment completion
    setTimeout(() => {
      deployment.status = 'running';
      logger.info(`✅ Deployment ${deployment.id} running`);
      this.emit('deploymentRunning', deployment);
    }, 2000);

    return deployment;
  }

  /**
   * Select optimal regions for deployment
   */
  selectOptimalRegions(preferredRegions = [], count = 1) {
    const availableRegions = Array.from(this.regions.values())
      .filter(r => r.health === 'healthy')
      .filter(r => r.currentLoad < this.options.maxRegionLoad ?? 1000) // If max load is set
      .sort((a, b) => {
        // Prioritize preferred regions
        const aPref = preferredRegions.includes(a.id) ? 0 : 1;
        const bPref = preferredRegions.includes(b.id) ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;

        // Then by priority
        return b.priority - a.priority;
      });

    return availableRegions.slice(0, count).map(r => r.id);
  }

  /**
   * Synchronize state across regions
   */
  async syncState(deploymentId) {
    const replicas = this.replicationGroups.get(deploymentId);
    if (!replicas || replicas.length <= 1) {
      return; // Nothing to sync
    }

    const primaryReplica = replicas.find(r => r.role === 'primary');
    if (!primaryReplica) {
      logger.error(`No primary replica found for ${deploymentId}`);
      return;
    }

    try {
      for (let i = 1; i < replicas.length; i++) {
        const replica = replicas[i];

        if (replica.dataVersion < primaryReplica.dataVersion) {
          logger.info(`🔄 Syncing ${replica.id} from ${primaryReplica.id}`);

          // Simulate state transfer
          replicas[i].dataVersion = primaryReplica.dataVersion;
          replicas[i].lastSyncTime = Date.now();
          replicas[i].syncStatus = 'in-sync';

          this.syncLog.push({
            timestamp: Date.now(),
            from: primaryReplica.id,
            to: replica.id,
            dataVersion: primaryReplica.dataVersion,
            status: 'success'
          });

          this.emit('stateSynced', {
            deploymentId,
            from: primaryReplica.id,
            to: replica.id,
            dataVersion: primaryReplica.dataVersion
          });
        }
      }
    } catch (error) {
      logger.error(`State sync failed for ${deploymentId}: ${error.message}`);
    }
  }

  /**
   * Perform automatic failover if primary region fails
   */
  async performFailover(deploymentId, failureReason = 'unknown') {
    const replicas = this.replicationGroups.get(deploymentId);
    if (!replicas || replicas.length < 2) {
      logger.error(`Cannot failover ${deploymentId}: Only ${replicas?.length || 0} replica(s)`);
      return null;
    }

    const primaryIndex = replicas.findIndex(r => r.role === 'primary');
    let newPrimaryIndex = -1;

    // Find first healthy secondary
    for (let i = 0; i < replicas.length; i++) {
      if (i !== primaryIndex && replicas[i].status === 'running') {
        newPrimaryIndex = i;
        break;
      }
    }

    if (newPrimaryIndex === -1) {
      logger.error(`No healthy secondaries for failover of ${deploymentId}`);
      return null;
    }

    // Perform failover
    const oldPrimary = replicas[primaryIndex];
    const newPrimary = replicas[newPrimaryIndex];

    oldPrimary.role = `failed-${oldPrimary.role}`;
    newPrimary.role = 'primary';

    logger.warn(`🔄 Failover: ${oldPrimary.id} → ${newPrimary.id} (Reason: ${failureReason})`);

    this.emit('failover', {
      deploymentId,
      oldPrimary: oldPrimary.id,
      newPrimary: newPrimary.id,
      reason: failureReason,
      timestamp: Date.now()
    });

    return {
      deploymentId,
      oldPrimaryRegion: oldPrimary.regionId,
      newPrimaryRegion: newPrimary.regionId,
      timestamp: Date.now()
    };
  }

  /**
   * Monitor health of all regions
   */
  async checkRegionHealth() {
    for (const [regionId, region] of this.regions) {
      try {
        // Simulate health check
        const isHealthy = Math.random() > 0.1; // 90% health probability

        const previousHealth = region.health;
        region.health = isHealthy ? 'healthy' : 'degraded';

        if (previousHealth !== region.health) {
          logger.warn(`🏥 Region ${regionId} health changed: ${previousHealth} → ${region.health}`);
          this.healthStatus.set(regionId, region.health);

          // Trigger failover if primary became unhealthy
          if (!isHealthy && this.options.enableAutoFailover) {
            await this.handleRegionFailure(regionId);
          }
        }
      } catch (error) {
        logger.error(`Health check failed for ${regionId}: ${error.message}`);
        region.health = 'unhealthy';
      }
    }
  }

  /**
   * Handle region failure - failover all deployments in that region
   */
  async handleRegionFailure(failedRegionId) {
    logger.error(`🚨 Region failure detected: ${failedRegionId}`);

    for (const [deploymentId, replicas] of this.replicationGroups) {
      const isPrimaryInFailedRegion = replicas.find(
        r => r.role === 'primary' && r.regionId === failedRegionId
      );

      if (isPrimaryInFailedRegion) {
        await this.performFailover(deploymentId, `Region ${failedRegionId} failure`);
      }
    }
  }

  /**
   * Get deployment status across regions
   */
  getDeploymentStatus(deploymentId) {
    const replicas = this.replicationGroups.get(deploymentId);
    if (!replicas) {
      return null;
    }

    return {
      deploymentId,
      replicas: replicas.map(r => ({
        id: r.id,
        role: r.role,
        region: r.regionId,
        status: r.status,
        cloud: r.cloudProvider,
        dataVersion: r.dataVersion,
        syncStatus: r.syncStatus,
        lastSync: r.lastSyncTime
      })),
      primaryRegion: replicas.find(r => r.role === 'primary')?.regionId,
      totalReplicas: replicas.length,
      syncedReplicas: replicas.filter(r => r.syncStatus === 'in-sync').length
    };
  }

  /**
   * List all multi-region deployments
   */
  listDeployments() {
    const deployments = [];
    for (const [deploymentId, replicas] of this.replicationGroups) {
      deployments.push({
        deploymentId,
        replicas: replicas.length,
        status: this.getDeploymentStatus(deploymentId)
      });
    }
    return deployments;
  }

  /**
   * Get cross-region latency insights
   */
  getLatencyInsights() {
    const regions = Array.from(this.regions.keys());
    const insights = {};

    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const key = `${regions[i]}-${regions[j]}`;
        // Simulate latency between regions
        const baseLatency = 50 + (i * 10) + (j * 15);
        const jitter = Math.random() * 20;
        insights[key] = Math.round(baseLatency + jitter);
      }
    }

    return insights;
  }

  /**
   * Start multi-region orchestrator
   */
  start() {
    logger.info('🌍 Starting Multi-Region Orchestrator');

    // State sync interval
    this.interval = setInterval(async () => {
      for (const deploymentId of this.replicationGroups.keys()) {
        await this.syncState(deploymentId);
      }
    }, this.options.syncInterval);

    // Health check interval
    this.healthCheckInterval = setInterval(async () => {
      await this.checkRegionHealth();
    }, this.options.healthCheckInterval);

    this.emit('started');
  }

  /**
   * Stop multi-region orchestrator
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    logger.info('🌍 Stopped Multi-Region Orchestrator');
    this.emit('stopped');
  }

  /**
   * Get comprehensive dashboard
   */
  getDashboard() {
    return {
      regions: Array.from(this.regions.values()).map(r => ({
        id: r.id,
        name: r.name,
        cloud: r.cloudProvider,
        health: r.health,
        deployments: r.deploymentCount,
        load: r.currentLoad
      })),
      totalDeployments: this.replicationGroups.size,
      deployments: this.listDeployments(),
      latencies: this.getLatencyInsights(),
      syncLog: this.syncLog.slice(-20) // Show last 20 sync operations
    };
  }
}

module.exports = MultiRegionOrchestrator;
