const Plugin = require('../../src/Plugin.js');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const tar = require('tar');

/**
 * Remote Plugin Registry Client for ANCHOR
 * Enables downloading and installing plugins from remote registries
 */
class RegistryClientPlugin extends Plugin {
  constructor(options) {
    super(options);
    this.name = 'anchor-registry-client';
    this.version = '1.0.0';
    this.description = 'Remote plugin registry client for downloading plugins';

    // Registry configuration
    this.registries = this.config.registries || [
      'http://localhost:3000/registry.json'
    ];

    this.cacheDir = this.config.cacheDir || './plugin-cache';
    this.installedPlugins = new Map();
  }

  async init(api) {
    await super.init(api);

    // Ensure cache directory exists
    await fs.ensureDir(this.cacheDir);

    // Load installed plugins registry
    await this.loadInstalledRegistry();

    this.api.info('Registry Client Plugin initialized');
  }

  async loadInstalledRegistry() {
    try {
      const registryPath = path.join(this.cacheDir, 'installed.json');
      if (await fs.pathExists(registryPath)) {
        const data = await fs.readJson(registryPath);
        this.installedPlugins = new Map(Object.entries(data));
      }
    } catch (error) {
      this.api.warn('Failed to load installed plugins registry:', error);
    }
  }

  async saveInstalledRegistry() {
    try {
      const registryPath = path.join(this.cacheDir, 'installed.json');
      const data = Object.fromEntries(this.installedPlugins);
      await fs.writeJson(registryPath, data, { spaces: 2 });
    } catch (error) {
      this.api.error('Failed to save installed plugins registry:', error);
    }
  }

  async fetchRegistry(url) {
    try {
      this.api.info(`Fetching plugin registry from ${url}`);
      const response = await axios.get(url, { timeout: 10000 });
      return response.data;
    } catch (error) {
      this.api.error(`Failed to fetch registry ${url}:`, error);
      throw error;
    }
  }

  async getAllAvailablePlugins() {
    const allPlugins = new Map();

    for (const registryUrl of this.registries) {
      try {
        const registry = await this.fetchRegistry(registryUrl);

        for (const plugin of registry.plugins || []) {
          // Mark as installed if we have it
          plugin.installed = this.installedPlugins.has(plugin.id);
          plugin.registryUrl = registryUrl;
          allPlugins.set(plugin.id, plugin);
        }
      } catch (error) {
        this.api.warn(`Failed to load registry ${registryUrl}:`, error);
      }
    }

    return Array.from(allPlugins.values());
  }

  async downloadPlugin(pluginId, downloadUrl) {
    try {
      this.api.info(`Downloading plugin ${pluginId} from ${downloadUrl}`);

      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: 30000
      });

      const tempPath = path.join(this.cacheDir, `${pluginId}.tar.gz`);
      const writer = fs.createWriteStream(tempPath);

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(tempPath));
        writer.on('error', reject);
      });
    } catch (error) {
      this.api.error(`Failed to download plugin ${pluginId}:`, error);
      throw error;
    }
  }

  async extractPlugin(archivePath, pluginId) {
    try {
      const extractPath = path.join(this.cacheDir, pluginId);

      // Remove existing directory if it exists
      await fs.remove(extractPath);

      // Extract archive
      await tar.extract({
        file: archivePath,
        cwd: this.cacheDir,
        strip: 1 // Remove root directory from archive
      });

      // Clean up archive
      await fs.remove(archivePath);

      return extractPath;
    } catch (error) {
      this.api.error(`Failed to extract plugin ${pluginId}:`, error);
      throw error;
    }
  }

  async installRemotePlugin(pluginId) {
    try {
      // Get plugin info from registries
      const availablePlugins = await this.getAllAvailablePlugins();
      const pluginInfo = availablePlugins.find(p => p.id === pluginId);

      if (!pluginInfo) {
        throw new Error(`Plugin ${pluginId} not found in any registry`);
      }

      if (!pluginInfo.downloadUrl) {
        throw new Error(`Plugin ${pluginId} has no download URL`);
      }

      // Download plugin
      const archivePath = await this.downloadPlugin(pluginId, pluginInfo.downloadUrl);

      // Extract plugin
      const pluginPath = await this.extractPlugin(archivePath, pluginId);

      // Verify plugin structure
      await this.verifyPluginStructure(pluginPath, pluginId);

      // Move to plugins directory
      const finalPath = path.join(__dirname, '..', pluginId);
      await fs.move(pluginPath, finalPath, { overwrite: true });

      // Install dependencies if package.json exists
      const packageJsonPath = path.join(finalPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        await this.installPluginDependencies(finalPath);
      }

      // Mark as installed
      this.installedPlugins.set(pluginId, {
        ...pluginInfo,
        installedAt: new Date().toISOString(),
        version: pluginInfo.version
      });

      await this.saveInstalledRegistry();

      this.api.info(`Plugin ${pluginId} installed successfully`);
      return { success: true, path: finalPath };
    } catch (error) {
      this.api.error(`Failed to install remote plugin ${pluginId}:`, error);
      throw error;
    }
  }

  async verifyPluginStructure(pluginPath, pluginId) {
    const packageJsonPath = path.join(pluginPath, 'package.json');
    const indexJsPath = path.join(pluginPath, 'index.js');

    if (!await fs.pathExists(packageJsonPath)) {
      throw new Error(`Plugin ${pluginId} missing package.json`);
    }

    if (!await fs.pathExists(indexJsPath)) {
      throw new Error(`Plugin ${pluginId} missing index.js`);
    }

    // Basic package.json validation
    const packageJson = await fs.readJson(packageJsonPath);
    if (!packageJson.name || !packageJson.main) {
      throw new Error(`Plugin ${pluginId} has invalid package.json`);
    }
  }

  async installPluginDependencies(pluginPath) {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      this.api.info(`Installing dependencies for plugin in ${pluginPath}`);
      await execAsync('npm install', { cwd: pluginPath, timeout: 60000 });
      this.api.info('Plugin dependencies installed successfully');
    } catch (error) {
      this.api.warn(`Failed to install plugin dependencies:`, error);
      // Don't fail the installation for dependency issues
    }
  }

  // API endpoints
  getApiRoutes() {
    return {
      'GET /api/plugins/registry': this.listRegistryPlugins.bind(this),
      'POST /api/plugins/registry/:pluginId/install': this.installRemotePluginEndpoint.bind(this),
      'GET /api/plugins/registry/search': this.searchPlugins.bind(this)
    };
  }

  async listRegistryPlugins(req, res) {
    try {
      const plugins = await this.getAllAvailablePlugins();
      res.json({ success: true, plugins });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async installRemotePluginEndpoint(req, res) {
    try {
      const { pluginId } = req.params;
      const result = await this.installRemotePlugin(pluginId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async searchPlugins(req, res) {
    try {
      const { q, category, capability } = req.query;
      let plugins = await this.getAllAvailablePlugins();

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
  }

  async destroy() {
    await this.saveInstalledRegistry();
    await super.destroy();
  }
}

module.exports = RegistryClientPlugin;