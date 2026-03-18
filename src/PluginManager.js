const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./Logger.js');

/**
 * PluginManager - Manages ANCHOR plugins
 * Provides plugin loading, lifecycle management, and event routing
 */
class PluginManager extends EventEmitter {
  constructor(pluginDir = './plugins') {
    super();
    this.pluginDir = pluginDir;
    this.plugins = new Map(); // pluginName -> plugin instance
    this.pluginConfigs = new Map(); // pluginName -> config
    this.eventListeners = new Map(); // eventName -> Set of plugins
  }

  /**
   * Load all plugins from the plugin directory
   */
  async loadPlugins() {
    try {
      logger.info('🔌 Loading ANCHOR plugins...');

      // Ensure plugin directory exists
      try {
        await fs.mkdir(this.pluginDir, { recursive: true });
      } catch (error) {
        // Directory already exists
      }

      // Read plugin directory
      const entries = await fs.readdir(this.pluginDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          await this.loadPlugin(entry.name);
        }
      }

      logger.info(`✅ Loaded ${this.plugins.size} plugins`);
    } catch (error) {
      logger.error(`❌ Failed to load plugins: ${error.message}`);
    }
  }

  /**
   * Validate plugin manifest
   */
  validatePluginManifest(packageJson) {
    // Check required fields
    if (!packageJson.name || !packageJson.version) {
      return false;
    }

    // Check permissions (if specified)
    if (packageJson.permissions) {
      const allowedPermissions = ['network', 'dns', 'filesystem', 'database', 'system'];
      if (!Array.isArray(packageJson.permissions)) {
        return false;
      }
      for (const perm of packageJson.permissions) {
        if (!allowedPermissions.includes(perm)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Verify plugin signature
   */
  async verifyPluginSignature(pluginPath, pluginName) {
    try {
      const sigFile = path.join(pluginPath, 'plugin.sig');
      const pubKeyFile = path.join(__dirname, '..', 'keys', 'plugin-public.pem');

      // Check if signature file exists
      try {
        await fs.access(sigFile);
      } catch (error) {
        // No signature required in development, but log warning
        logger.warn(`⚠️ Plugin ${pluginName} has no signature file`);
        return process.env.NODE_ENV !== 'production'; // Allow in dev, reject in prod
      }

      // Check if public key exists
      try {
        await fs.access(pubKeyFile);
      } catch (error) {
        logger.warn(`⚠️ Plugin public key not found`);
        return process.env.NODE_ENV !== 'production';
      }

      // Read signature and public key
      const signature = await fs.readFile(sigFile, 'base64');
      const publicKey = await fs.readFile(pubKeyFile, 'utf8');

      // Create hash of plugin files (simplified - hash package.json for now)
      const packageJson = await fs.readFile(path.join(pluginPath, 'package.json'));
      const hash = crypto.createHash('sha256').update(packageJson).digest();

      // Verify signature
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(hash);
      const isValid = verify.verify(publicKey, signature, 'base64');

      if (!isValid) {
        logger.error(`❌ Plugin ${pluginName} signature verification failed`);
        return false;
      }

      logger.info(`✅ Plugin ${pluginName} signature verified`);
      return true;
    } catch (error) {
      logger.error(`❌ Error verifying plugin signature: ${error.message}`);
      return false;
    }
  }
  async loadPlugin(pluginName) {
    try {
      const pluginPath = path.join(this.pluginDir, pluginName);
      const packagePath = path.join(pluginPath, 'package.json');

      // Check if plugin has package.json
      try {
        await fs.access(packagePath);
      } catch (error) {
        logger.warn(`⚠️ Plugin ${pluginName} missing package.json, skipping`);
        return;
      }

      // Read package.json
      const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
      const mainFile = packageJson.main || 'index.js';
      const mainPath = path.join(pluginPath, mainFile);

      // Validate plugin manifest
      if (!this.validatePluginManifest(packageJson)) {
        logger.warn(`⚠️ Plugin ${pluginName} has invalid manifest, skipping`);
        return;
      }

      // Verify plugin signature if present
      if (!await this.verifyPluginSignature(pluginPath, pluginName)) {
        logger.warn(`⚠️ Plugin ${pluginName} signature verification failed, skipping`);
        return;
      }

      // Check if main file exists
      try {
        await fs.access(mainPath);
      } catch (error) {
        logger.warn(`⚠️ Plugin ${pluginName} main file ${mainFile} not found, skipping`);
        return;
      }

      // Load plugin
      const absoluteMainPath = path.resolve(mainPath);
      const PluginClass = require(absoluteMainPath);

      if (!PluginClass || typeof PluginClass !== 'function') {
        logger.warn(`⚠️ Plugin ${pluginName} does not export a class, skipping`);
        return;
      }

      // Create plugin instance
      const plugin = new PluginClass({
        name: pluginName,
        version: packageJson.version || '1.0.0',
        description: packageJson.description || '',
        config: this.getPluginConfig(pluginName)
      });

      // Initialize plugin
      if (typeof plugin.init === 'function') {
        await plugin.init(this.createPluginAPI(pluginName));
      }

      // Register plugin
      this.plugins.set(pluginName, plugin);

      // Register event listeners
      if (plugin.events && Array.isArray(plugin.events)) {
        for (const event of plugin.events) {
          if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
          }
          this.eventListeners.get(event).add(pluginName);
        }
      }

      logger.info(`🔌 Loaded plugin: ${pluginName} v${packageJson.version}`);

    } catch (error) {
      logger.error(`❌ Failed to load plugin ${pluginName}: ${error.message}`);
    }
  }

  /**
   * Create plugin API for a specific plugin
   */
  createPluginAPI(pluginName) {
    return {
      // Event emission
      emit: (event, data) => this.emitToPlugins(event, data, pluginName),

      // Server management
      getServers: () => this.getServers(),
      startServer: (serverId) => this.startServer(serverId),
      stopServer: (serverId) => this.stopServer(serverId),
      restartServer: (serverId) => this.restartServer(serverId),

      // Scaling
      getScalingStats: () => this.getScalingStats(),
      triggerScaleUp: (serverId) => this.triggerScaleUp(serverId),
      triggerScaleDown: (serverId) => this.triggerScaleDown(serverId),

      // Node information
      getNodes: () => this.getNodes(),
      getNodeInfo: (nodeId) => this.getNodeInfo(nodeId),

      // Metrics
      getMetrics: (serverId) => this.getMetrics(serverId),

      // Configuration
      getConfig: () => this.getPluginConfig(pluginName),
      setConfig: (config) => this.setPluginConfig(pluginName, config),

      // Logging
      log: (level, message) => this.pluginLog(pluginName, level, message),
      info: (message) => this.pluginLog(pluginName, 'info', message),
      warn: (message) => this.pluginLog(pluginName, 'warn', message),
      error: (message) => this.pluginLog(pluginName, 'error', message)
    };
  }

  /**
   * Emit event to all plugins that listen for it
   */
  emitToPlugins(event, data, sourcePlugin = null) {
    // Emit to core system
    this.emit(event, data);

    // Emit to listening plugins
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const pluginName of listeners) {
        if (pluginName !== sourcePlugin) { // Don't emit back to source
          const plugin = this.plugins.get(pluginName);
          if (plugin && typeof plugin.onEvent === 'function') {
            try {
              plugin.onEvent(event, data);
            } catch (error) {
              logger.error(`❌ Plugin ${pluginName} error handling event ${event}: ${error.message}`);
            }
          }
        }
      }
    }
  }

  /**
   * Get plugin configuration
   */
  getPluginConfig(pluginName) {
    return this.pluginConfigs.get(pluginName) || {};
  }

  /**
   * Set plugin configuration
   */
  setPluginConfig(pluginName, config) {
    this.pluginConfigs.set(pluginName, config);
  }

  /**
   * Plugin-specific logging
   */
  pluginLog(pluginName, level, message) {
    logger.log(level, `[Plugin:${pluginName}] ${message}`);
  }

  /**
   * Get all loaded plugins
   */
  getPlugins() {
    const result = {};
    for (const [name, plugin] of this.plugins) {
      result[name] = {
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        events: plugin.events || []
      };
    }
    return result;
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (plugin && typeof plugin.destroy === 'function') {
      try {
        await plugin.destroy();
      } catch (error) {
        logger.error(`❌ Error destroying plugin ${pluginName}: ${error.message}`);
      }
    }

    // Remove from event listeners
    for (const listeners of this.eventListeners.values()) {
      listeners.delete(pluginName);
    }

    // Remove plugin
    this.plugins.delete(pluginName);
    logger.info(`🔌 Unloaded plugin: ${pluginName}`);
  }

  /**
   * Reload a plugin
   */
  async reloadPlugin(pluginName) {
    await this.unloadPlugin(pluginName);
    await this.loadPlugin(pluginName);
  }

  // Placeholder methods - these would be implemented to connect to actual systems
  getServers() { return {}; }
  startServer(id) { logger.info(`Plugin requested server start: ${id}`); }
  stopServer(id) { logger.info(`Plugin requested server stop: ${id}`); }
  restartServer(id) { logger.info(`Plugin requested server restart: ${id}`); }
  getScalingStats() { return {}; }
  triggerScaleUp(_id) { 
    logger.info(`Plugin requested scale up: ${_id}`); 
  }
  triggerScaleDown(_id) { 
    logger.info(`Plugin requested scale down: ${_id}`); 
  }
  getNodes() { return {}; }
  getNodeInfo() { return {}; }
  getMetrics() { return {}; }
}

module.exports = PluginManager;