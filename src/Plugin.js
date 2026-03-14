/**
 * Base Plugin class for ANCHOR plugins
 * All plugins should extend this class
 */
class Plugin {
  constructor(options = {}) {
    this.name = options.name || 'unknown-plugin';
    this.version = options.version || '1.0.0';
    this.description = options.description || '';
    this.config = options.config || {};

    // Events this plugin listens to
    this.events = [];

    // Plugin API (set by PluginManager)
    this.api = null;
  }

  /**
   * Initialize the plugin
   * Called when plugin is loaded
   */
  async init(api) {
    this.api = api;
    this.api.info(`${this.name} v${this.version} initialized`);
  }

  /**
   * Handle events
   * Called when events this plugin listens to are emitted
   */
  onEvent() {
    // Override in subclass
  }

  /**
   * Clean up resources
   * Called when plugin is unloaded
   */
  async destroy() {
    this.api.info(`${this.name} destroyed`);
  }

  /**
   * Get plugin configuration
   */
  getConfig(key, defaultValue = null) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  /**
   * Set plugin configuration
   */
  setConfig(key, value) {
    this.config[key] = value;
    if (this.api) {
      this.api.setConfig(this.config);
    }
  }
}

module.exports = Plugin;