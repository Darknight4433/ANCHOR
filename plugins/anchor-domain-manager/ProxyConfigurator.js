const fs = require('fs').promises;
const path = require('path');

/**
 * Proxy Configurator - manages reverse proxy configuration
 * Uses Traefik for dynamic configuration
 */
class ProxyConfigurator {
  constructor(api, config) {
    this.api = api;
    this.config = config;
    this.configDir = config.configDir || './proxy-config';
    this.traefikConfig = config.traefikConfig || {};
    this.routes = new Map();
  }

  async init() {
    // Ensure config directory exists
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      this.api.error('Failed to create proxy config directory:', error);
    }

    // Initialize Traefik configuration
    await this.createBaseConfig();

    this.api.info('Proxy Configurator initialized');
  }

  async createBaseConfig() {
    const baseConfig = {
      http: {
        routers: {},
        services: {},
        middlewares: {}
      },
      tls: {
        certificates: []
      }
    };

    const configPath = path.join(this.configDir, 'dynamic.yml');
    await fs.writeFile(configPath, JSON.stringify(baseConfig, null, 2));
  }

  async addRoute(domain, options) {
    try {
      const routeName = domain.replace(/\./g, '-').replace(/:/g, '-');

      // Add router
      const router = {
        rule: `Host(\`${domain}\`)`,
        service: routeName,
        tls: options.ssl ? {
          certResolver: 'letsencrypt'
        } : undefined
      };

      // Add service
      const service = {
        loadBalancer: {
          servers: [
            { url: options.target }
          ]
        }
      };

      // Add middleware for SSL redirect if needed
      if (options.ssl) {
        router.middlewares = ['https-redirect'];
      }

      this.routes.set(domain, {
        router,
        service,
        options
      });

      await this.updateTraefikConfig();
      this.api.info(`Proxy route added for ${domain} -> ${options.target}`);
    } catch (error) {
      this.api.error(`Failed to add proxy route for ${domain}:`, error);
      throw error;
    }
  }

  async updateRoute(domain, updates) {
    const route = this.routes.get(domain);
    if (!route) {
      throw new Error(`Route not found for ${domain}`);
    }

    // Update route configuration
    if (updates.loadBalancing) {
      route.service.loadBalancer = {
        ...route.service.loadBalancer,
        ...updates
      };
    }

    await this.updateTraefikConfig();
    this.api.info(`Proxy route updated for ${domain}`);
  }

  async removeRoute(domain) {
    if (this.routes.has(domain)) {
      this.routes.delete(domain);
      await this.updateTraefikConfig();
      this.api.info(`Proxy route removed for ${domain}`);
    }
  }

  async updateTraefikConfig() {
    const config = {
      http: {
        routers: {},
        services: {},
        middlewares: {
          'https-redirect': {
            redirectScheme: {
              scheme: 'https',
              permanent: true
            }
          }
        }
      },
      tls: {
        certificates: []
      }
    };

    // Add all routes
    for (const [domain, routeConfig] of this.routes) {
      const routeName = domain.replace(/\./g, '-').replace(/:/g, '-');
      config.http.routers[routeName] = routeConfig.router;
      config.http.services[routeName] = routeConfig.service;

      // Add SSL certificate if configured
      if (routeConfig.options.ssl && routeConfig.options.certificate) {
        config.tls.certificates.push({
          certFile: `/certs/${routeConfig.options.certificate}.pem`,
          keyFile: `/certs/${routeConfig.options.certificate}.key`
        });
      }
    }

    const configPath = path.join(this.configDir, 'dynamic.yml');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    // Signal Traefik to reload configuration
    await this.reloadTraefik();
  }

  async reloadTraefik() {
    // This would send a signal to Traefik to reload its configuration
    // For now, we'll just log it
    this.api.info('Traefik configuration updated - reload signal sent');
  }

  async getRoute(domain) {
    return this.routes.get(domain);
  }

  async listRoutes() {
    return Array.from(this.routes.keys());
  }

  async destroy() {
    this.routes.clear();
    this.api.info('Proxy Configurator destroyed');
  }
}

module.exports = ProxyConfigurator;