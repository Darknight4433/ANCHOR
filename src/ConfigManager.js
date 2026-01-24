const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

/**
 * ConfigManager - Handles configuration file loading and validation
 */
class ConfigManager {
  constructor(configPath = null) {
    this.configPath = configPath || this.getDefaultConfigPath();
    this.config = {};
  }

  /**
   * Get default config path
   */
  getDefaultConfigPath() {
    const home = process.env.HOME || '/tmp';
    return path.join(home, '.process-manager', 'config.yaml');
  }

  /**
   * Load configuration from file
   */
  load() {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.warn(`Config file not found: ${this.configPath}`);
        this.config = this.getDefaultConfig();
        return this.config;
      }

      const content = fs.readFileSync(this.configPath, 'utf8');
      const ext = path.extname(this.configPath).toLowerCase();

      let parsed;
      if (ext === '.yaml' || ext === '.yml') {
        parsed = YAML.parse(content);
      } else if (ext === '.json') {
        parsed = JSON.parse(content);
      } else {
        throw new Error(`Unsupported config format: ${ext}`);
      }

      this.config = this.mergeWithDefaults(parsed);
      return this.config;
    } catch (error) {
      console.error(`Error loading config: ${error.message}`);
      this.config = this.getDefaultConfig();
      return this.config;
    }
  }

  /**
   * Save configuration to file
   */
  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      }

      const ext = path.extname(this.configPath).toLowerCase();
      let content;

      if (ext === '.yaml' || ext === '.yml') {
        content = YAML.stringify(this.config, { indent: 2 });
      } else if (ext === '.json') {
        content = JSON.stringify(this.config, null, 2);
      } else {
        throw new Error(`Unsupported config format: ${ext}`);
      }

      fs.writeFileSync(this.configPath, content);
      return true;
    } catch (error) {
      console.error(`Error saving config: ${error.message}`);
      return false;
    }
  }

  /**
   * Create default config file
   */
  createDefault() {
    this.config = this.getDefaultConfig();
    return this.save();
  }

  /**
   * Get default configuration
   */
  getDefaultConfig() {
    return {
      daemon: {
        port: 9876,
        host: 'localhost',
        enableSocket: true,
        logLevel: 'info'
      },
      processes: {
        autoStart: true,
        autoRestart: true,
        restartDelay: 1000,
        gracefulShutdownTimeout: 5000
      },
      persistence: {
        enabled: true,
        saveInterval: 10000,
        dataDirectory: null // Use default if null
      },
      environment: {
        NODE_ENV: 'production'
      }
    };
  }

  /**
   * Merge loaded config with defaults
   */
  mergeWithDefaults(loaded) {
    const defaults = this.getDefaultConfig();
    return this.deepMerge(defaults, loaded);
  }

  /**
   * Deep merge objects
   */
  deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(target[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }

    return result;
  }

  /**
   * Get config value with dot notation
   */
  get(path, defaultValue = null) {
    const keys = path.split('.');
    let value = this.config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * Set config value with dot notation
   */
  set(path, value) {
    const keys = path.split('.');
    let current = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    current[keys[keys.length - 1]] = value;
  }

  /**
   * Get all config
   */
  getAll() {
    return this.config;
  }

  /**
   * Validate configuration
   */
  validate() {
    const errors = [];

    // Validate daemon config
    if (!Number.isInteger(this.config.daemon?.port) || this.config.daemon.port < 1 || this.config.daemon.port > 65535) {
      errors.push('daemon.port must be a valid port number (1-65535)');
    }

    // Validate processes config
    if (!Number.isInteger(this.config.processes?.restartDelay) || this.config.processes.restartDelay < 0) {
      errors.push('processes.restartDelay must be a non-negative integer');
    }

    if (!Number.isInteger(this.config.processes?.gracefulShutdownTimeout) || this.config.processes.gracefulShutdownTimeout < 0) {
      errors.push('processes.gracefulShutdownTimeout must be a non-negative integer');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Make YAML optional - fall back to simple config if not available
try {
  require('yaml');
} catch (e) {
  // YAML not installed, provide warning during load
}

module.exports = ConfigManager;
