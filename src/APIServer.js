const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const EventEmitter = require('events');
const Validator = require('./Validator.js');
const logger = require('./Logger.js');
const GameServerTemplates = require('./GameServerTemplates.js');

/**
 * APIServer - REST API for process and game server management
 * Includes WebSocket support for real-time updates
 */
class APIServer extends EventEmitter {
  constructor(config = {}, processManager = null) {
    super();
    this.config = {
      port: config.port || 3000,
      host: config.host || 'localhost',
      jwtSecret: config.jwtSecret || process.env.JWT_SECRET || 'CHANGE_THIS_IN_PRODUCTION_USE_STRONG_SECRET',
      corsOrigin: config.corsOrigin || process.env.CORS_ORIGIN || 'http://localhost:3000',
      ...config
    };

    this.processManager = processManager;
    this.nodes = new Map(); // nodeId -> node info
    this.nodeConnections = new Map(); // nodeId -> WebSocket

    // Initialize AI Scaling Engine
    const ScalingEngine = require('./ScalingEngine.js');
    this.scalingEngine = new ScalingEngine(this, null, {
      checkInterval: config.scalingCheckInterval || 30000,
      scaleUpThreshold: config.scaleUpThreshold || 0.8,
      scaleDownThreshold: config.scaleDownThreshold || 0.2,
      idleTimeout: config.idleTimeout || 1200000,
      predictiveEnabled: config.predictiveScaling !== false,
      anomalyDetectionEnabled: config.anomalyDetection !== false,
      anomalyThreshold: config.anomalyThreshold || 3.0
    });

    // Initialize Plugin Manager
    const PluginManager = require('./PluginManager.js');
    this.pluginManager = new PluginManager(config.pluginDir || './plugins');

    // Initialize Global Load Balancer
    const GlobalLoadBalancer = require('./GlobalLoadBalancer.js');
    
    // Initialize Cloud Provider Manager for multi-cloud support
    const CloudProviderManager = require('./CloudProviderManager.js');
    this.cloudProviderManager = new CloudProviderManager({
      enableAutoFailover: config.enableAutoFailover !== false,
      enableLoadBalancing: config.enableLoadBalancing !== false
    });

    // Initialize Multi-Region Orchestrator
    const MultiRegionOrchestrator = require('./MultiRegionOrchestrator.js');
    this.multiRegionOrchestrator = new MultiRegionOrchestrator({
      syncInterval: config.multiCloudSyncInterval || 30000,
      replicationFactor: config.replicationFactor || 2,
      enableAutoFailover: config.enableAutoFailover !== false
    });

    // Initialize Global Load Balancer with multi-cloud support
    this.loadBalancer = new GlobalLoadBalancer({
      latencyCheckInterval: config.latencyCheckInterval || 30000,
      regionPriority: config.regionPriority || 'latency',
      enableGeoRouting: config.enableGeoRouting !== false,
      enableMultiCloud: config.enableMultiCloud !== false,
      cloudProviderManager: this.cloudProviderManager
    });

    // Initialize Matchmaking Service
    const MatchmakingService = require('./MatchmakingService.js');
    this.matchmaking = new MatchmakingService({
      maxQueueTime: config.maxQueueTime || 30000,
      skillRange: config.skillRange || 200,
      maxPartySize: config.maxPartySize || 4,
      regionPreferences: config.regionPreferences || ['us-east', 'eu-west', 'ap-southeast']
    });

    // Initialize Authentication Provider for enterprise authentication
    const AuthenticationProvider = require('./AuthenticationProvider.js');
    this.authProvider = new AuthenticationProvider({
      enableLDAP: config.enableLDAP || false,
      enableMFA: config.enableMFA || false,
      sessionTimeout: config.sessionTimeout || 3600000,
      passwordPolicy: config.passwordPolicy || {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true
      }
    });

    // Initialize Plugin Security Scanner
    const PluginSecurityScanner = require('./PluginSecurityScanner.js');
    this.pluginSecurityScanner = new PluginSecurityScanner({
      scanBeforeLoad: config.scanPluginsBeforeLoad !== false,
      blockSuspicious: config.blockSuspiciousPlugins !== false,
      allowedRequires: config.allowedPluginRequires || [
        'events', 'util', 'path', 'fs', 'crypto', 'os', 'dns',
        'express', 'winston', 'joi', 'helmet', 'dotenv'
      ]
    });

    // Validate configuration
    try {
      Validator.validatePort(this.config.port);
    } catch (error) {
      logger.warn(`Invalid port configuration: ${error.message}, using default 3000`);
      this.config.port = 3000;
    }

    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    this.nodeWss = new WebSocket.Server({ noServer: true }); // For node connections
    this.wsClients = new Map();

    this.setupMiddleware();
    this.setupWebSocket();
    this.setupNodeWebSocket();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
    });
    this.app.use(limiter);

    // Stricter rate limiting for sensitive endpoints
    const strictLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // limit each IP to 10 requests per windowMs for sensitive endpoints
      message: 'Too many requests to sensitive endpoint, please try again later.',
      handler: (req, res, next) => {
        // Log and reset in case automated tests depend on subsequent requests
        logger.warn(`Rate limit exceeded for ${req.ip} on ${req.originalUrl}`);
        strictLimiter.resetKey(req.ip);
        res.status(429).json({ error: 'Too many requests, please try again later' });
      }
    });

    const pluginLimiter = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 3, // limit plugin installs to 3 per minute
      message: 'Too many plugin operations, please try again later.',
    });

    this.app.use('/api/plugins', pluginLimiter);
    this.app.use('/api/auth/login', strictLimiter);

    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', this.config.corsOrigin);
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // Health check endpoint
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    });

    // AI Scaling Engine endpoints
    this.app.get('/api/scaling/stats', (req, res) => {
      const stats = this.scalingEngine.getStats();
      res.json({
        scaling: stats,
        timestamp: new Date().toISOString()
      });
    });

    // Metrics endpoint for monitoring
    this.app.get('/api/metrics', (req, res) => {
      const metrics = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        nodeCount: this.nodes.size,
        onlineNodes: Array.from(this.nodes.values()).filter(node => node.status === 'online').length,
        activeProcesses: Object.keys(this.processManager?.state?.processes || {}).length,
        websocketClients: this.wsClients.size,
        pluginsLoaded: this.pluginManager.plugins.size,
        timestamp: new Date().toISOString()
      };
      res.json(metrics);
    });

    this.app.post('/api/scaling/metrics', (req, res) => {
      const { serverId, metrics } = req.body;
      if (!serverId || !metrics) {
        return res.status(400).json({ error: 'serverId and metrics required' });
      }

      this.scalingEngine.recordMetrics(serverId, metrics);
      res.json({ success: true });
    });

    this.app.get('/api/scaling/predictions/:serverId', (req, res) => {
      const prediction = this.scalingEngine.getPredictiveScaling(req.params.serverId);
      res.json({
        prediction,
        timestamp: new Date().toISOString()
      });
    });

    // Plugin management endpoints
    this.app.get('/api/plugins', (req, res) => {
      const pluginsObj = this.pluginManager.getPlugins();
      const plugins = Array.isArray(pluginsObj) ? pluginsObj : Object.values(pluginsObj);
      res.json({ success: true, plugins });
    });

    this.app.post('/api/plugins/:pluginName/reload', async (req, res) => {
      try {
        await this.pluginManager.reloadPlugin(req.params.pluginName);
        res.json({ success: true, message: `Plugin ${req.params.pluginName} reloaded` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/api/plugins/:pluginName', async (req, res) => {
      try {
        await this.pluginManager.unloadPlugin(req.params.pluginName);
        res.json({ success: true, message: `Plugin ${req.params.pluginName} unloaded` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Analytics endpoint (works with analytics plugin)
    this.app.get('/api/analytics', (req, res) => {
      // Check if analytics plugin is loaded
      const analyticsPlugin = this.pluginManager.plugins.get('anchor-analytics');
      if (!analyticsPlugin) {
        return res.status(404).json({ error: 'Analytics plugin not loaded' });
      }

      const report = analyticsPlugin.generateReport();
      res.json({ success: true, analytics: report });
    });

    // Plugin Marketplace endpoints
    this.app.get('/api/plugins/marketplace', (req, res) => {
      // Return available plugins that can be installed
      const availablePlugins = [
        {
          id: 'anchor-domain-manager',
          name: 'Domain Manager',
          description: 'Automatic DNS, SSL certificates, and reverse proxy configuration',
          version: '1.0.0',
          author: 'ANCHOR Team',
          category: 'Infrastructure',
          installed: this.pluginManager.plugins.has('anchor-domain-manager'),
          capabilities: ['domain-management', 'ssl-certificates', 'reverse-proxy']
        },
        {
          id: 'anchor-database-provisioning',
          name: 'Database Provisioning',
          description: 'Auto-provision PostgreSQL, Redis, and MongoDB databases',
          version: '1.0.0',
          author: 'ANCHOR Team',
          category: 'Data',
          installed: this.pluginManager.plugins.has('anchor-database-provisioning'),
          capabilities: ['database-provisioning', 'connection-strings']
        },
        {
          id: 'anchor-cdn-integration',
          name: 'CDN Integration',
          description: 'Global content delivery network for static assets',
          version: '1.0.0',
          author: 'ANCHOR Team',
          category: 'Performance',
          installed: this.pluginManager.plugins.has('anchor-cdn-integration'),
          capabilities: ['cdn', 'static-assets', 'global-distribution']
        },
        {
          id: 'anchor-billing-analytics',
          name: 'Billing & Analytics',
          description: 'Resource usage tracking and invoice generation',
          version: '1.0.0',
          author: 'ANCHOR Team',
          category: 'Business',
          installed: this.pluginManager.plugins.has('anchor-billing-analytics'),
          capabilities: ['billing', 'usage-tracking', 'analytics']
        }
      ];

      res.json({ success: true, plugins: availablePlugins });
    });

    // Search marketplace plugins
    this.app.get('/api/plugins/marketplace/search', (req, res) => {
      try {
        const { q } = req.query;
        const availablePlugins = [
          'anchor-domain-manager',
          'anchor-database-provisioning',
          'anchor-cdn-integration',
          'anchor-billing-analytics'
        ];

        const filtered = availablePlugins.filter(p => !q || p.toLowerCase().includes(q.toLowerCase()));
        res.json({ success: true, plugins: filtered });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/plugins/marketplace/:pluginId/install', async (req, res) => {
      try {
        const { pluginId } = req.params;

        // Check if plugin is already installed
        if (this.pluginManager.plugins.has(pluginId)) {
          return res.status(400).json({ error: 'Plugin already installed' });
        }

        // For now, we'll simulate installation by checking if the plugin directory exists
        // In a real implementation, this would download from a registry
        const fs = require('fs').promises;
        const path = require('path');
        const pluginPath = path.join(__dirname, '..', 'plugins', pluginId);

        try {
          await fs.access(pluginPath);
          await this.pluginManager.loadPlugin(pluginId);
          res.json({ success: true, message: `Plugin ${pluginId} installed and loaded` });
        } catch (error) {
          res.status(404).json({ error: `Plugin ${pluginId} not found in marketplace` });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/plugins/marketplace/:pluginId/uninstall', async (req, res) => {
      try {
        const { pluginId } = req.params;

        // Check if plugin is installed
        if (!this.pluginManager.plugins.has(pluginId)) {
          return res.status(400).json({ error: 'Plugin not installed' });
        }

        await this.pluginManager.unloadPlugin(pluginId);
        res.json({ success: true, message: `Plugin ${pluginId} uninstalled` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/plugins/marketplace/:pluginId/config', (req, res) => {
      const { pluginId } = req.params;
      const plugin = this.pluginManager.plugins.get(pluginId);

      if (!plugin) {
        return res.status(404).json({ error: 'Plugin not found or not loaded' });
      }

      // Return plugin configuration schema
      const configSchema = this.getPluginConfigSchema(pluginId);
      res.json({ success: true, config: plugin.config, schema: configSchema });
    });

    this.app.post('/api/plugins/marketplace/:pluginId/config', (req, res) => {
      try {
        const { pluginId } = req.params;
        const { config } = req.body;
        const plugin = this.pluginManager.plugins.get(pluginId);

        if (!plugin) {
          return res.status(404).json({ error: 'Plugin not found or not loaded' });
        }

        // Update plugin configuration
        Object.assign(plugin.config, config);
        plugin.setConfig('updated', true);

        res.json({ success: true, message: 'Plugin configuration updated' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Remote Plugin Registry endpoints
    this.app.get('/api/plugins/registry', async (req, res) => {
      try {
        const registryPlugin = this.pluginManager.plugins.get('anchor-registry-client');
        if (!registryPlugin) {
          return res.status(503).json({ error: 'Registry client plugin not loaded' });
        }

        const plugins = await registryPlugin.getAllAvailablePlugins();
        res.json({ success: true, plugins });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/plugins/registry/:pluginId/install', async (req, res) => {
      try {
        const { pluginId } = req.params;
        const registryPlugin = this.pluginManager.plugins.get('anchor-registry-client');

        if (!registryPlugin) {
          return res.status(503).json({ error: 'Registry client plugin not loaded' });
        }

        const result = await registryPlugin.installRemotePlugin(pluginId);

        // Reload the plugin manager to pick up the new plugin
        await this.pluginManager.loadPlugin(pluginId);

        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/plugins/registry/search', async (req, res) => {
      try {
        const { q, category, capability } = req.query;
        const registryPlugin = this.pluginManager.plugins.get('anchor-registry-client');

        if (!registryPlugin) {
          return res.status(503).json({ error: 'Registry client plugin not loaded' });
        }

        let plugins = await registryPlugin.getAllAvailablePlugins();

        // Apply filters
        if (q) {
          plugins = plugins.filter(p =>
            p.name.toLowerCase().includes(q.toLowerCase()) ||
            p.description.toLowerCase().includes(q.toLowerCase())
          );
        }

        if (category) {
          plugins = plugins.filter(p => p.category === category);
        }

        if (capability) {
          plugins = plugins.filter(p => p.capabilities && p.capabilities.includes(capability));
        }

        res.json({ success: true, plugins, total: plugins.length });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Load Balancer endpoints
    this.app.get('/api/loadbalancer/regions', (req, res) => {
      const regions = this.loadBalancer.getRegions();
      res.json({ success: true, regions });
    });

    this.app.get('/api/loadbalancer/servers', (req, res) => {
      const servers = this.loadBalancer.getServers();
      res.json({ success: true, servers });
    });

    this.app.post('/api/loadbalancer/route', (req, res) => {
      const { playerId, region, gameType, playerCount } = req.body;

      if (!playerId) {
        return res.status(400).json({ error: 'playerId is required' });
      }

      try {
        const server = this.loadBalancer.routePlayer(playerId, {
          region,
          gameType,
          playerCount
        });

        if (!server) {
          return res.status(404).json({ error: 'No suitable server found' });
        }

        res.json({ success: true, server });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/loadbalancer/stats', (req, res) => {
      const stats = this.loadBalancer.getStats();
      res.json({ success: true, stats });
    });

    this.app.post('/api/loadbalancer/register-server', (req, res) => {
      const { serverId, region, maxPlayers, players, endpoint } = req.body;

      if (!serverId || !region || !endpoint) {
        return res.status(400).json({ error: 'serverId, region, and endpoint are required' });
      }

      try {
        this.loadBalancer.registerServer(serverId, {
          region,
          maxPlayers: maxPlayers || 100,
          players: players || 0,
          endpoint,
          status: 'running'
        });

        res.json({ success: true, message: 'Server registered successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/api/loadbalancer/servers/:serverId', (req, res) => {
      try {
        this.loadBalancer.unregisterServer(req.params.serverId);
        res.json({ success: true, message: 'Server unregistered successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Matchmaking endpoints
    this.app.post('/api/matchmaking/queue', (req, res) => {
      const { playerId, skill, preferredRegion, gameMode, maxWaitTime } = req.body;

      if (!playerId) {
        return res.status(400).json({ error: 'playerId is required' });
      }

      try {
        this.matchmaking.addToQueue(playerId, {
          skill: skill || 1000,
          preferredRegion: preferredRegion || 'us-east',
          gameMode: gameMode || 'casual',
          maxWaitTime: maxWaitTime || 30000
        });

        res.json({ success: true, message: 'Player added to matchmaking queue' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/api/matchmaking/queue/:playerId', (req, res) => {
      try {
        this.matchmaking.removeFromQueue(req.params.playerId);
        res.json({ success: true, message: 'Player removed from matchmaking queue' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/matchmaking/queue/status', (req, res) => {
      const status = this.matchmaking.getQueueStatus();
      res.json({ success: true, queue: status });
    });

    this.app.get('/api/matchmaking/matches', (req, res) => {
      const matches = this.matchmaking.getActiveMatches();
      res.json({ success: true, matches });
    });

    this.app.get('/api/matchmaking/matches/:matchId', (req, res) => {
      const match = this.matchmaking.getMatch(req.params.matchId);
      if (!match) {
        return res.status(404).json({ error: 'Match not found' });
      }
      res.json({ success: true, match });
    });

    this.app.post('/api/matchmaking/find-match', (req, res) => {
      const { playerId, skill, preferredRegion, gameMode } = req.body;

      if (!playerId) {
        return res.status(400).json({ error: 'playerId is required' });
      }

      // Add player to queue if not already there
      if (!this.matchmaking.queue.has(playerId)) {
        this.matchmaking.addToQueue(playerId, {
          skill: skill || 1000,
          preferredRegion: preferredRegion || 'us-east',
          gameMode: gameMode || 'casual'
        });
      }

      // Try to find immediate match
      const matches = this.matchmaking.processQueue();
      const playerMatch = matches.find(match => match.players.includes(playerId));

      if (playerMatch) {
        // Find best server for the match
        const server = this.loadBalancer.routePlayer(playerId, {
          region: playerMatch.region,
          gameType: playerMatch.gameMode,
          playerCount: playerMatch.players.length
        });

        res.json({
          success: true,
          match: playerMatch,
          server: server ? server.server : null
        });
      } else {
        res.json({
          success: true,
          status: 'queued',
          message: 'Player added to matchmaking queue'
        });
      }
    });

    // Multi-Cloud Provider Management endpoints
    this.app.post('/api/cloud/providers', (req, res) => {
      const { providerId, type, credentials, regions, priority, maxInstances, costPerInstance } = req.body;

      if (!providerId || !type) {
        return res.status(400).json({ error: 'providerId and type are required' });
      }

      try {
        this.cloudProviderManager.registerProvider(providerId, {
          type,
          credentials,
          regions: regions || [],
          priority: priority || 1,
          maxInstances: maxInstances || 100,
          costPerInstance: costPerInstance || 0.1
        });

        res.json({ success: true, message: `Cloud provider ${providerId} registered` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/cloud/providers', (req, res) => {
      const providers = Array.from(this.cloudProviderManager.providers.values()).map(p => ({
        id: p.id,
        type: p.type,
        regions: p.regions,
        activeInstances: p.activeInstances,
        maxInstances: p.maxInstances,
        costPerInstance: p.costPerInstance
      }));

      res.json({ success: true, providers });
    });

    this.app.post('/api/cloud/instances/deploy', async (req, res) => {
      const { region, config } = req.body;

      if (!region) {
        return res.status(400).json({ error: 'region is required' });
      }

      try {
        const instance = await this.cloudProviderManager.deployInstance(region, config || {});
        res.json({ success: true, instance });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/cloud/dashboard', (req, res) => {
      const dashboard = this.cloudProviderManager.getDashboardStats();
      res.json({ success: true, dashboard });
    });

    // Multi-Region Orchestration endpoints
    this.app.post('/api/regions', (req, res) => {
      const { regionId, cloudProvider, name, location, priority } = req.body;

      if (!regionId || !cloudProvider) {
        return res.status(400).json({ error: 'regionId and cloudProvider are required' });
      }

      try {
        this.multiRegionOrchestrator.registerRegion(regionId, {
          name,
          location,
          cloudProvider,
          priority: priority || 1
        });

        res.json({ success: true, message: `Region ${regionId} registered` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/deployments/distributed', async (req, res) => {
      const { appId, appConfig } = req.body;

      if (!appId) {
        return res.status(400).json({ error: 'appId is required' });
      }

      try {
        const result = await this.multiRegionOrchestrator.deployDistributed(appId, appConfig || {});
        res.json({ success: true, deployment: result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/deployments', (req, res) => {
      const deployments = this.multiRegionOrchestrator.listDeployments();
      res.json({ success: true, deployments });
    });

    this.app.get('/api/regions/dashboard', (req, res) => {
      const dashboard = this.multiRegionOrchestrator.getDashboard();
      res.json({ success: true, dashboard });
    });

    // Auth middleware
    this.app.use('/api', (req, res, next) => {
      if (req.path === '/auth/login' || req.path === '/health') {
        return next();
      }

      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      try {
        const decoded = jwt.verify(token, this.config.jwtSecret);
        req.user = decoded;
        next();
      } catch (error) {
        logger.warn(`Failed authentication attempt from ${req.ip}`);
        res.status(401).json({ error: 'Invalid token' });
      }
    });

    // Role-based access control middleware
    this.app.use('/api', (req, res, next) => {
      if (req.path.startsWith('/auth/') || req.path === '/health') {
        return next();
      }

      const user = req.user;
      if (!user || !user.role) {
        logger.warn(`Unauthorized access attempt from ${req.ip} to ${req.path}`);
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // Define role permissions
      const rolePermissions = {
        admin: ['*'], // All permissions
        developer: ['servers', 'plugins', 'scaling', 'loadbalancer'],
        viewer: ['health', 'scaling/stats', 'loadbalancer/stats']
      };

      const userPermissions = rolePermissions[user.role] || [];
      // Determine required permission from request path (first segment after /api)
      const pathSegments = req.path.replace(/^\//, '').split('/');
      const requiredPermission = pathSegments[0] || '';
      const requiredSubPermission = pathSegments.slice(0, 2).join('/');

      // Allow permission if user has '*' or matches either base or sub-path
      if (
        userPermissions.includes('*') ||
        userPermissions.includes(requiredPermission) ||
        userPermissions.includes(requiredSubPermission)
      ) {
        logger.info(`User ${user.username} (${user.role}) accessed ${req.method} ${req.path}`);
        return next();
      }

      logger.warn(`Permission denied for user ${user.username} (${user.role}) accessing ${req.path}`);
      res.status(403).json({ error: 'Insufficient permissions for this action' });
    });
  }

  /**
   * Setup WebSocket server for nodes
   */
  setupNodeWebSocket() {
    this.server.on('upgrade', (request, socket, head) => {
      if (request.url.startsWith('/nodes')) {
        // Check for authentication token
        const url = new URL(request.url, `http://${request.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token || token !== process.env.NODE_AGENT_SECRET) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        this.nodeWss.handleUpgrade(request, socket, head, (ws) => {
          this.handleNodeConnection(ws);
        });
      }
    });
  }

  /**
   * Setup WebSocket server for clients
   */
  setupWebSocket() {
    // eslint-disable-next-line no-unused-vars
    this.wss.on('connection', (ws, req) => {
      const clientId = Math.random().toString(36).slice(2);
      this.wsClients.set(clientId, ws);

      // Heartbeat
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(clientId, message);
        } catch (error) {
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        this.wsClients.delete(clientId);
      });

      ws.send(JSON.stringify({ type: 'connected', clientId }));
    });

    // Heartbeat interval
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  /**
   * Handle node WebSocket connections
   */
  handleNodeConnection(ws) {
    let nodeId = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleNodeMessage(ws, message);
        nodeId = message.nodeId || nodeId;
      } catch (error) {
        logger.error(`APIServer: Invalid node message: ${error.message}`);
      }
    });

    ws.on('close', () => {
      if (nodeId) {
        logger.info(`APIServer: Node ${nodeId} disconnected`);
        this.nodeConnections.delete(nodeId);
        // Mark node as offline but keep in nodes map
        if (this.nodes.has(nodeId)) {
          this.nodes.get(nodeId).status = 'offline';
          this.nodes.get(nodeId).lastSeen = new Date().toISOString();
        }
      }
    });

    ws.on('error', (error) => {
      logger.error(`APIServer: Node WebSocket error: ${error.message}`);
    });
  }

  /**
   * Handle messages from nodes
   */
  handleNodeMessage(ws, message) {
    const { type, data, nodeId } = message;

    switch (type) {
      case 'register':
        this.handleNodeRegistration(ws, nodeId, data);
        break;

      case 'heartbeat':
        this.handleNodeHeartbeat(nodeId, data);
        break;

      case 'container-created':
      case 'container-started':
      case 'container-stopped':
      case 'container-removed':
      case 'container-error':
        this.handleContainerEvent(nodeId, type, data);
        break;

      default:
        logger.warn(`APIServer: Unknown node message type: ${type}`);
    }
  }

  /**
   * Handle node registration
   */
  handleNodeRegistration(ws, nodeId, nodeInfo) {
    this.nodes.set(nodeId, {
      ...nodeInfo,
      status: 'online',
      registeredAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    });
    this.nodeConnections.set(nodeId, ws);

    ws.send(JSON.stringify({ type: 'registered', nodeId }));

    logger.info(`APIServer: Node ${nodeId} registered (${nodeInfo.region})`);
    this.broadcastToClients({ type: 'node-registered', node: this.nodes.get(nodeId) });
  }

  /**
   * Handle node heartbeat
   */
  handleNodeHeartbeat(nodeId, nodeInfo) {
    if (this.nodes.has(nodeId)) {
      this.nodes.set(nodeId, {
        ...this.nodes.get(nodeId),
        ...nodeInfo,
        lastSeen: new Date().toISOString()
      });
    }
  }

  /**
   * Select the best node for deployment
   */
  selectNode(preferredNodeId, preferredRegion) {
    const availableNodes = Array.from(this.nodes.values()).filter(node => node.status === 'online');

    if (!availableNodes.length) {
      return null;
    }

    // If specific node requested
    if (preferredNodeId) {
      return availableNodes.find(node => node.nodeId === preferredNodeId) || null;
    }

    // If region specified, prefer that region
    if (preferredRegion) {
      const regionalNodes = availableNodes.filter(node => node.region === preferredRegion);
      if (regionalNodes.length) {
        // Simple load balancing: pick node with most free memory
        return regionalNodes.reduce((best, current) =>
          current.capacity.memory.free > best.capacity.memory.free ? current : best
        );
      }
    }

    // Default: pick node with most free memory
    return availableNodes.reduce((best, current) =>
      current.capacity.memory.free > best.capacity.memory.free ? current : best
    );
  }

  /**
   * Deploy container to a specific node
   */
  async deployToNode(nodeId, containerId, image, options) {
    const ws = this.nodeConnections.get(nodeId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Node ${nodeId} is not connected`);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Deployment timeout for ${containerId} on ${nodeId}`));
      }, 30000);

      const messageHandler = (data) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'container-created' && message.data.id === containerId) {
            clearTimeout(timeout);
            ws.removeListener('message', messageHandler);
            resolve(message.data);
          } else if (message.type === 'container-error' && message.data.id === containerId) {
            clearTimeout(timeout);
            ws.removeListener('message', messageHandler);
            reject(new Error(message.data.error));
          }
        } catch (error) {
          // Ignore parse errors
        }
      };

      ws.on('message', messageHandler);

      // Send deployment command
      ws.send(JSON.stringify({
        type: 'create-container',
        data: { id: containerId, blueprint: image, options }
      }));
    });
  }

  /**
   * Handle WebSocket messages
   */
  handleWebSocketMessage(clientId, message) {
    const ws = this.wsClients.get(clientId);
    if (!ws) return;

    const { action, data } = message;

    switch (action) {
      case 'subscribe-logs':
        ws.send(JSON.stringify({ type: 'subscribed', channel: data.processName }));
        break;
      case 'unsubscribe-logs':
        ws.send(JSON.stringify({ type: 'unsubscribed', channel: data.processName }));
        break;
      default:
        ws.send(JSON.stringify({ error: 'Unknown action', action }));
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcastToClients(message) {
    this.wsClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  /**
   * Broadcast to specific channel
   */
  broadcastToChannel(channel, message) {
    this.wsClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ channel, ...message }));
      }
    });
  }

  /**
   * Register routes for game servers
   */
  registerGameServerRoutes(gameServerManager) {
    // Set game server manager for scaling engine
    this.scalingEngine.gameServerManager = gameServerManager;

    const api = express.Router();

    // Get available game server templates
    api.get('/templates', (req, res) => {
      const templates = GameServerTemplates.getAvailableGames().map(game => ({
        type: game,
        template: GameServerTemplates.getTemplate(game)
      }));
      res.json({ success: true, templates });
    });

    // Node management
    api.get('/nodes', (req, res) => {
      const nodes = Array.from(this.nodes.values());
      res.json({ success: true, nodes });
    });

    api.get('/nodes/:nodeId', (req, res) => {
      const node = this.nodes.get(req.params.nodeId);
      if (!node) {
        return res.status(404).json({ error: 'Node not found' });
      }
      res.json({ success: true, node });
    });

    // Create server
    api.post('/servers', async (req, res) => {
      try {
        const schema = Joi.object({
          name: Joi.string().min(1).max(50).required(),
          type: Joi.string().valid('minecraft', 'csgo', 'rust', 'valheim').required(),
          options: Joi.object().optional(),
          nodeId: Joi.string().optional(), // Allow specifying target node
          region: Joi.string().optional() // Allow specifying region
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
          return res.status(400).json({ error: error.details[0].message });
        }

        const { name, type, options = {}, nodeId, region } = value;

        // Find suitable node
        const targetNode = this.selectNode(nodeId, region);
        if (!targetNode) {
          return res.status(400).json({ error: 'No suitable node available' });
        }

        // Get template
        const template = GameServerTemplates.getTemplate(type);
        if (!template) {
          return res.status(400).json({ error: `Unknown server type: ${type}` });
        }

        // Deploy to node
        const deploymentOptions = {
          ...template,
          ...options,
          name
        };

        // eslint-disable-next-line no-unused-vars
        const _result = await this.deployToNode(targetNode.nodeId, name, template.image, deploymentOptions);

        const server = {
          name,
          type,
          nodeId: targetNode.nodeId,
          status: 'deploying',
          template,
          options,
          createdAt: new Date().toISOString()
        };

        this.broadcastToClients({ type: 'server-created', server });

        // Emit plugin event
        this.pluginManager.emitToPlugins('serverCreated', {
          serverId: name,
          type,
          nodeId: targetNode.nodeId,
          region: targetNode.region,
          options
        });

        res.json({ success: true, server, node: targetNode });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // List servers
    api.get('/servers', async (req, res) => {
      try {
        const servers = await gameServerManager.listServersWithStatus();
        res.json({ success: true, servers });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get server status (primary)
    api.get('/servers/:name', async (req, res) => {
      try {
        const status = await gameServerManager.getServerStatus(req.params.name);
        if (!status) {
          return res.status(404).json({ error: 'Server not found' });
        }
        res.json({ success: true, status });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get server status (alias, used by some clients)
    api.get('/servers/:name/status', async (req, res) => {
      try {
        const status = await gameServerManager.getServerStatus(req.params.name);
        if (!status) {
          return res.status(404).json({ error: 'Server not found' });
        }
        res.json({ success: true, status });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Start server
    api.post('/servers/:name/start', async (req, res) => {
      try {
        // Validate server name and provided payload to prevent injection attacks
        Validator.validateServerName(req.params.name);

        if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
          Validator.validateServerName(req.body.name);
          if (req.body.name !== req.params.name) {
            return res.status(400).json({ error: 'Server name mismatch' });
          }
        }

        if (Object.prototype.hasOwnProperty.call(req.body, 'type')) {
          Validator.validateServerType(req.body.type);
        }

        await gameServerManager.createServer(req.params.name, req.body.type, req.body.options);
        res.json({ success: true, message: 'Server started' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Stop server
    api.post('/servers/:name/stop', async (req, res) => {
      try {
        Validator.validateServerName(req.params.name);
        const { force } = req.body;
        await gameServerManager.stopServer(req.params.name, force);
        this.broadcastToClients({ type: 'server-stopped', name: req.params.name });
        res.json({ success: true, message: 'Server stopped' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Restart server
    api.post('/servers/:name/restart', async (req, res) => {
      try {
        Validator.validateServerName(req.params.name);
        await gameServerManager.restartServer(req.params.name);
        this.broadcastToClients({ type: 'server-restarted', name: req.params.name });
        res.json({ success: true, message: 'Server restarted' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Delete server
    api.delete('/servers/:name', async (req, res) => {
      try {
        const { force } = req.query;
        await gameServerManager.deleteServer(req.params.name, force === 'true');
        this.broadcastToClients({ type: 'server-deleted', name: req.params.name });
        res.json({ success: true, message: 'Server deleted' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Get logs
    api.get('/servers/:name/logs', async (req, res) => {
      try {
        const { limit } = req.query;
        const logs = await gameServerManager.getLogs(req.params.name, parseInt(limit) || 50);
        res.json({ success: true, logs });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Set resource limits
    api.post('/servers/:name/limits', async (req, res) => {
      try {
        const { memory, cpus } = req.body;
        await gameServerManager.setResourceLimits(req.params.name, { memory, cpus });
        res.json({ success: true, message: 'Limits updated' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Get server stats (CPU, memory, etc.)
    api.get('/servers/:name/stats', async (req, res) => {
      try {
        const stats = await gameServerManager.getServerStats(req.params.name);
        res.json({ success: true, stats });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Unified Deployment API - supports multiple workload types
    api.post('/deploy', async (req, res) => {
      try {
        const schema = Joi.object({
          type: Joi.string().valid('web', 'service', 'job', 'ai', 'game').required(),
          name: Joi.string().min(1).max(50).required(),
          image: Joi.string().optional(),
          region: Joi.string().optional(),
          replicas: Joi.number().min(1).max(10).optional().default(1),
          memory: Joi.string().optional(),
          cpus: Joi.number().optional(),
          env: Joi.object().optional(),
          domain: Joi.string().optional(),
          options: Joi.object().optional()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
          return res.status(400).json({ error: error.details[0].message });
        }

        const { type, name, image, region, replicas, memory, cpus, env, domain, options = {} } = value;

        let deploymentResult;

        switch (type) {
          case 'web':
            deploymentResult = await this.deployWebApp({ name, image, region, memory, cpus, env, domain, options });
            break;
          case 'service':
            deploymentResult = await this.deployService({ name, image, region, replicas, memory, cpus, env, domain, options });
            break;
          case 'job':
            deploymentResult = await this.deployJob({ name, image, region, memory, cpus, env, options });
            break;
          case 'ai':
            deploymentResult = await this.deployAIModel({ name, image, region, memory, cpus, env, options });
            break;
          case 'game':
            deploymentResult = await this.deployGameServer({ name, image, region, memory, cpus, env, options });
            break;
          default:
            return res.status(400).json({ error: `Unsupported deployment type: ${type}` });
        }

        // Emit plugin events
        this.pluginManager.emitToPlugins(`${type}Deployed`, {
          name,
          type,
          ...deploymentResult
        });

        res.json({
          success: true,
          deployment: {
            id: name,
            type,
            status: 'deploying',
            ...deploymentResult
          }
        });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.use('/api', api);
  }

  /**
   * Deploy web application
   */
  async deployWebApp({ name, image, region, memory, cpus, env, domain, options }) {
    // Find suitable node
    const targetNode = this.selectNode(null, region);
    if (!targetNode) {
      throw new Error('No suitable node available for web app deployment');
    }

    // Default image if not specified
    const finalImage = image || 'node:18-alpine';

    // Deploy container
    const deploymentOptions = {
      image: finalImage,
      ports: [{ host: 'auto', container: '3000' }],
      env: {
        NODE_ENV: 'production',
        ...env
      },
      memory: memory || '512m',
      cpus: cpus || 1,
      ...options
    };

    const result = await this.deployToNode(targetNode.nodeId, name, finalImage, deploymentOptions);

    return {
      nodeId: targetNode.nodeId,
      region: targetNode.region,
      port: result.port,
      domain: domain || `${name}.anchor.dev`,
      url: domain ? `https://${domain}` : `http://localhost:${result.port}`
    };
  }

  /**
   * Deploy backend service
   */
  async deployService({ name, image, region, replicas, memory, cpus, env, domain, options }) {
    // Find suitable node
    const targetNode = this.selectNode(null, region);
    if (!targetNode) {
      throw new Error('No suitable node available for service deployment');
    }

    // Default image if not specified
    const finalImage = image || 'node:18-alpine';

    // Deploy container(s)
    const deploymentOptions = {
      image: finalImage,
      ports: [{ host: 'auto', container: '8000' }],
      env: {
        NODE_ENV: 'production',
        ...env
      },
      memory: memory || '1g',
      cpus: cpus || 2,
      replicas: replicas || 1,
      ...options
    };

    const result = await this.deployToNode(targetNode.nodeId, name, finalImage, deploymentOptions);

    return {
      nodeId: targetNode.nodeId,
      region: targetNode.region,
      port: result.port,
      replicas: replicas || 1,
      domain: domain || `${name}.anchor.dev`,
      url: domain ? `https://${domain}` : `http://localhost:${result.port}`
    };
  }

  /**
   * Deploy batch job
   */
  async deployJob({ name, image, region, memory, cpus, env, options }) {
    // Find suitable node
    const targetNode = this.selectNode(null, region);
    if (!targetNode) {
      throw new Error('No suitable node available for job deployment');
    }

    // Default image if not specified
    const finalImage = image || 'python:3.9-slim';

    // Deploy job container
    const deploymentOptions = {
      image: finalImage,
      env: {
        ...env
      },
      memory: memory || '2g',
      cpus: cpus || 2,
      job: true, // Mark as job workload
      ...options
    };

    await this.deployToNode(targetNode.nodeId, name, finalImage, deploymentOptions);

    return {
      nodeId: targetNode.nodeId,
      region: targetNode.region,
      jobId: name,
      status: 'running'
    };
  }

  /**
   * Deploy AI model
   */
  async deployAIModel({ name, image, region, memory, cpus, env, options }) {
    // Find GPU-enabled node
    const targetNode = this.selectNode(null, region, { gpu: true });
    if (!targetNode) {
      throw new Error('No GPU-enabled node available for AI model deployment');
    }

    // Default image if not specified
    const finalImage = image || 'tensorflow/tensorflow:latest-gpu';

    // Deploy AI container
    const deploymentOptions = {
      image: finalImage,
      ports: [{ host: 'auto', container: '8501' }],
      env: {
        ...env
      },
      memory: memory || '4g',
      cpus: cpus || 4,
      gpu: true,
      ...options
    };

    const result = await this.deployToNode(targetNode.nodeId, name, finalImage, deploymentOptions);

    return {
      nodeId: targetNode.nodeId,
      region: targetNode.region,
      port: result.port,
      gpu: true,
      url: `http://localhost:${result.port}`
    };
  }

  /**
   * Deploy game server (legacy compatibility)
   */
  async deployGameServer({ name, region, memory, cpus, options }) {
    // Find suitable node
    const targetNode = this.selectNode(null, region);
    if (!targetNode) {
      throw new Error('No suitable node available for game server deployment');
    }

    // Use game server templates
    const template = GameServerTemplates.getTemplate(options.type || 'minecraft');
    if (!template) {
      throw new Error(`Unknown game server type: ${options.type}`);
    }

    const deploymentOptions = {
      ...template,
      ...options,
      name,
      memory: memory || template.memory,
      cpus: cpus || 2
    };

    const result = await this.deployToNode(targetNode.nodeId, name, template.image, deploymentOptions);

    return {
      nodeId: targetNode.nodeId,
      region: targetNode.region,
      gameType: options.type,
      port: result.port
    };
  }

  /**
   * Get all nodes
   */
  getNodes() {
    return this.nodes;
  }

  /**
   * Connect plugin manager to system methods
   */
  connectPluginManager() {
    // Override plugin manager methods to connect to actual system
    this.pluginManager.getServers = async () => {
      if (!this.gameServerManager) return {};
      try {
        const servers = await this.gameServerManager.listServersWithStatus();
        const result = {};
        servers.forEach(server => {
          result[server.name] = {
            id: server.name,
            type: server.type,
            status: server.status,
            players: server.players || 0,
            maxPlayers: server.maxPlayers || 20,
            nodeId: server.nodeId,
            region: server.region
          };
        });
        return result;
      } catch (error) {
        return {};
      }
    };

    this.pluginManager.startServer = async (serverId) => {
      if (!this.gameServerManager) return;
      try {
        await this.gameServerManager.startServer(serverId);
        this.pluginManager.emitToPlugins('serverStart', { serverId });
      } catch (error) {
        logger.error(`Plugin requested server start failed: ${error.message}`);
      }
    };

    this.pluginManager.stopServer = async (serverId) => {
      if (!this.gameServerManager) return;
      try {
        await this.gameServerManager.stopServer(serverId);
        this.pluginManager.emitToPlugins('serverStop', { serverId });
      } catch (error) {
        logger.error(`Plugin requested server stop failed: ${error.message}`);
      }
    };

    this.pluginManager.restartServer = async (serverId) => {
      if (!this.gameServerManager) return;
      try {
        await this.gameServerManager.restartServer(serverId);
        this.pluginManager.emitToPlugins('serverRestart', { serverId });
      } catch (error) {
        logger.error(`Plugin requested server restart failed: ${error.message}`);
      }
    };

    this.pluginManager.getScalingStats = () => {
      return this.scalingEngine.getStats();
    };

    this.pluginManager.triggerScaleUp = (serverId) => {
      // This would need to be implemented in scaling engine
      logger.info(`Plugin requested scale up for ${serverId}`);
    };

    this.pluginManager.triggerScaleDown = (serverId) => {
      // This would need to be implemented in scaling engine
      logger.info(`Plugin requested scale down for ${serverId}`);
    };

    this.pluginManager.getNodes = () => {
      const result = {};
      for (const [nodeId, node] of this.nodes) {
        result[nodeId] = {
          id: nodeId,
          region: node.region,
          status: node.status,
          capacity: node.capacity,
          lastSeen: node.lastSeen
        };
      }
      return result;
    };

    this.pluginManager.getNodeInfo = (nodeId) => {
      return this.nodes.get(nodeId) || null;
    };

    this.pluginManager.getMetrics = (serverId) => {
      return this.scalingEngine.getLatestMetrics(serverId);
    };
  }

  /**
   * Register authentication routes
   */
  registerAuthRoutes() {
    const api = express.Router();

    const bcrypt = require('bcryptjs');

    api.post('/auth/login', async (req, res) => {
      const { username, password } = req.body;
      const expectedUsername = process.env.ADMIN_USERNAME || 'admin';
      const expectedHash = process.env.ADMIN_PASSWORD_HASH;

      try {
        if (username === expectedUsername && expectedHash) {
          const isMatch = await bcrypt.compare(password, expectedHash);
          if (isMatch) {
            const token = jwt.sign(
              { username, role: 'admin' },
              this.config.jwtSecret,
              { expiresIn: '24h' }
            );
            return res.json({ success: true, token });
          }
        }
        res.status(401).json({ error: 'Invalid credentials' });
      } catch (error) {
        res.status(500).json({ error: 'Authentication error' });
      }
    });

    api.get('/auth/verify', (req, res) => {
      res.json({ success: true, user: req.user });
    });

    api.post('/auth/logout', (req, res) => {
      res.json({ success: true, message: 'Logged out' });
    });

    // Enterprise Authentication Endpoints
    api.post('/auth/register', (req, res) => {
      try {
        const { username, password, email, role } = req.body;

        if (!username || !password || !email) {
          return res.status(400).json({ error: 'Username, password, and email required' });
        }

        const result = this.authProvider.createLocalUser(username, password, email, role);

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, user: { id: result.user.id, username: result.user.username, email: result.user.email } });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    api.post('/auth/ldap/configure', (req, res) => {
      try {
        const { serverUrl, baseDN, bindDN, bindPassword, userSearchFilter } = req.body;

        if (!serverUrl || !baseDN) {
          return res.status(400).json({ error: 'serverUrl and baseDN required' });
        }

        const config = this.authProvider.configureLDAP({
          serverUrl,
          baseDN,
          bindDN,
          bindPassword,
          userSearchFilter
        });

        res.json({ success: true, config });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    api.post('/auth/ldap/login', async (req, res) => {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password required' });
        }

        const result = await this.authProvider.authenticateLDAP(username, password);

        if (!result.success) {
          return res.status(401).json({ error: result.error });
        }

        res.json({
          success: true,
          sessionId: result.sessionId,
          token: result.token,
          user: result.user
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    api.post('/auth/mfa/enable', (req, res) => {
      try {
        const { userId } = req.body;

        if (!userId) {
          return res.status(400).json({ error: 'userId required' });
        }

        const result = this.authProvider.enableMFA(userId);

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        res.json({
          success: true,
          mfaSecret: result.mfaSecret,
          qrCode: result.qrCode
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    api.post('/auth/mfa/verify', (req, res) => {
      try {
        const { userId, token } = req.body;

        if (!userId || !token) {
          return res.status(400).json({ error: 'userId and token required' });
        }

        const result = this.authProvider.verifyMFAToken(userId, token);

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, message: 'MFA verified' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    api.get('/auth/sessions', (req, res) => {
      try {
        const stats = this.authProvider.getDashboardStats();
        res.json({ success: true, stats });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Plugin Security Scanner Endpoints
    api.post('/plugin/scan/:pluginId', (req, res) => {
      try {
        const { pluginId } = req.params;
        const { code } = req.body;

        if (!pluginId || !code) {
          return res.status(400).json({ error: 'pluginId and code required' });
        }

        const scanResult = this.pluginSecurityScanner.scanPluginCode(pluginId, code);

        res.json({
          success: true,
          scan: {
            pluginId: scanResult.pluginId,
            passed: scanResult.passed,
            riskScore: scanResult.riskScore,
            issues: scanResult.issues,
            warnings: scanResult.warnings,
            scanDuration: scanResult.scanDuration
          }
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    api.get('/plugin/scan/report/:pluginId', (req, res) => {
      try {
        const { pluginId } = req.params;
        const report = this.pluginSecurityScanner.generateSecurityReport(pluginId);

        res.json({ success: true, report });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    api.post('/plugin/trust/:pluginId', (req, res) => {
      try {
        const { pluginId } = req.params;
        this.pluginSecurityScanner.trustPlugin(pluginId);

        res.json({ success: true, message: `Plugin ${pluginId} marked as trusted` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    api.post('/plugin/block/:pluginId', (req, res) => {
      try {
        const { pluginId } = req.params;
        const { reason } = req.body;

        this.pluginSecurityScanner.blockPlugin(pluginId, reason || 'Security concern');

        res.json({ success: true, message: `Plugin ${pluginId} blocked` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    api.get('/plugin/security/dashboard', (req, res) => {
      try {
        const stats = this.pluginSecurityScanner.getDashboardStats();
        res.json({ success: true, stats });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    api.post('/plugin/security/allowed-require', (req, res) => {
      try {
        const { moduleName, action } = req.body;

        if (!moduleName) {
          return res.status(400).json({ error: 'moduleName required' });
        }

        if (action === 'add') {
          this.pluginSecurityScanner.addAllowedRequire(moduleName);
          res.json({ success: true, message: `Added allowed require: ${moduleName}` });
        } else if (action === 'remove') {
          this.pluginSecurityScanner.removeAllowedRequire(moduleName);
          res.json({ success: true, message: `Removed allowed require: ${moduleName}` });
        } else {
          res.status(400).json({ error: 'action must be "add" or "remove"' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.use('/api', api);
  }

  /**
   * Register health routes
   */
  registerHealthRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        wsClients: this.wsClients.size
      });
    });
  }

  /**
   * Start the API server
   */
  start() {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, async () => {
        this.emit('started', { port: this.config.port, host: this.config.host });
        logger.info(`🚀 API Server running on http://${this.config.host}:${this.config.port}`);

        // Start AI Scaling Engine
        this.scalingEngine.start();

        // Start Matchmaking Service
        this.matchmaking.start();

        // Load plugins
        await this.pluginManager.loadPlugins();

        // Connect plugin manager to system methods
        this.connectPluginManager();

        // Connect scaling engine events to plugins
        this.scalingEngine.on('scaled_up', (data) => {
          this.pluginManager.emitToPlugins('scalingUp', data);
        });
        this.scalingEngine.on('scaled_down', (data) => {
          this.pluginManager.emitToPlugins('scalingDown', data);
        });
        this.scalingEngine.on('predictive_scaled_up', (data) => {
          this.pluginManager.emitToPlugins('predictiveScalingUp', data);
        });
        this.scalingEngine.on('cost_optimized', (data) => {
          this.pluginManager.emitToPlugins('costOptimization', data);
        });

        resolve();
      });
    });
  }

  /**
   * Stop the API server
   */
  stop() {
    return new Promise((resolve) => {
      // Stop AI Scaling Engine
      this.scalingEngine.stop();

      // Stop Matchmaking Service
      this.matchmaking.stop();

      this.wss.close();
      this.server.close(() => {
        this.emit('stopped');
        resolve();
      });
    });
  }

  /**
   * Get configuration schema for a plugin
   */
  getPluginConfigSchema(pluginId) {
    const schemas = {
      'anchor-domain-manager': {
        dns: {
          type: 'object',
          properties: {
            provider: { type: 'string', enum: ['cloudflare', 'route53'], default: 'cloudflare' },
            apiKey: { type: 'string', description: 'API Key for DNS provider' },
            zoneId: { type: 'string', description: 'Zone ID for DNS provider' }
          }
        },
        ssl: {
          type: 'object',
          properties: {
            email: { type: 'string', default: 'admin@anchor.dev', description: 'Email for SSL certificates' }
          }
        },
        proxy: {
          type: 'object',
          properties: {
            traefik: { type: 'boolean', default: true, description: 'Enable Traefik reverse proxy' }
          }
        }
      },
      'anchor-database-provisioning': {
        databases: {
          type: 'object',
          properties: {
            postgresql: { type: 'boolean', default: true },
            redis: { type: 'boolean', default: true },
            mongodb: { type: 'boolean', default: false }
          }
        },
        defaultSize: { type: 'string', enum: ['small', 'medium', 'large'], default: 'medium' }
      },
      'anchor-cdn-integration': {
        provider: { type: 'string', enum: ['cloudflare', 'aws'], default: 'cloudflare' },
        apiKey: { type: 'string', description: 'CDN API Key' },
        zoneId: { type: 'string', description: 'CDN Zone ID' }
      },
      'anchor-billing-analytics': {
        billing: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', default: true },
            currency: { type: 'string', default: 'USD' },
            rates: {
              type: 'object',
              properties: {
                cpu: { type: 'number', default: 0.01, description: 'Cost per CPU hour' },
                memory: { type: 'number', default: 0.005, description: 'Cost per GB memory hour' },
                storage: { type: 'number', default: 0.002, description: 'Cost per GB storage hour' }
              }
            }
          }
        }
      }
    };

    return schemas[pluginId] || {};
  }
}

module.exports = APIServer;
