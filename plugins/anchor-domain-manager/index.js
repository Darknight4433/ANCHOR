const Plugin = require('../../src/Plugin.js');
const DNSManager = require('./DNSManager.js');
const CertificateManager = require('./CertificateManager.js');
const ProxyConfigurator = require('./ProxyConfigurator.js');
const DomainRegistry = require('./DomainRegistry.js');

/**
 * Domain Manager Plugin for ANCHOR
 * Handles domain assignment, DNS configuration, SSL certificates, and reverse proxy routing
 */
class DomainManagerPlugin extends Plugin {
  constructor(options) {
    super(options);
    this.name = 'anchor-domain-manager';
    this.version = '1.0.0';
    this.description = 'Domain management, SSL certificates, and reverse proxy configuration';

    // Events this plugin listens to
    this.events = ['appDeployed', 'serviceDeployed', 'appScaled', 'serviceScaled'];

    // Components
    this.dnsManager = null;
    this.certificateManager = null;
    this.proxyConfigurator = null;
    this.domainRegistry = null;
  }

  async init(api) {
    await super.init(api);

    // Initialize components
    this.dnsManager = new DNSManager(this.api, this.config.dns || {});
    this.certificateManager = new CertificateManager(this.api, this.config.ssl || {});
    this.proxyConfigurator = new ProxyConfigurator(this.api, this.config.proxy || {});
    this.domainRegistry = new DomainRegistry(this.api, this.config.registry || {});

    // Initialize all components
    await Promise.all([
      this.dnsManager.init(),
      this.certificateManager.init(),
      this.proxyConfigurator.init(),
      this.domainRegistry.init()
    ]);

    this.api.info('Domain Manager Plugin initialized with DNS, SSL, and proxy support');
  }

  async onEvent(event, data) {
    try {
      switch (event) {
        case 'appDeployed':
          await this.handleAppDeployment(data);
          break;
        case 'serviceDeployed':
          await this.handleServiceDeployment(data);
          break;
        case 'appScaled':
          await this.handleAppScaling(data);
          break;
        case 'serviceScaled':
          await this.handleServiceScaling(data);
          break;
      }
    } catch (error) {
      this.api.error(`Domain Manager Plugin error handling ${event}:`, error);
    }
  }

  async handleAppDeployment(data) {
    const { name, domain, port } = data;

    if (!domain) {
      // Auto-assign subdomain if no custom domain
      const autoDomain = `${name}.anchor.dev`;
      data.domain = autoDomain;
      this.api.info(`Auto-assigned domain: ${autoDomain}`);
    }

    // Register domain
    await this.domainRegistry.registerDomain(name, data.domain, {
      type: 'app',
      port: port,
      target: name
    });

    // Configure DNS
    await this.dnsManager.configureDNS(data.domain, {
      type: 'A',
      value: this.getLoadBalancerIP(),
      ttl: 300
    });

    // Request SSL certificate
    await this.certificateManager.requestCertificate(data.domain);

    // Configure reverse proxy
    await this.proxyConfigurator.addRoute(data.domain, {
      target: `http://localhost:${port}`,
      ssl: true,
      certificate: data.domain
    });

    this.api.info(`Domain ${data.domain} configured for app ${name}`);
  }

  async handleServiceDeployment(data) {
    const { name, domain, ports } = data;

    if (!domain) {
      // Services might not need public domains unless specified
      return;
    }

    // Similar logic to app deployment but for services
    await this.domainRegistry.registerDomain(name, domain, {
      type: 'service',
      ports: ports,
      target: name
    });

    await this.dnsManager.configureDNS(domain, {
      type: 'A',
      value: this.getLoadBalancerIP(),
      ttl: 300
    });

    await this.certificateManager.requestCertificate(domain);

    // Configure proxy for each port
    for (const port of ports) {
      await this.proxyConfigurator.addRoute(`${domain}:${port}`, {
        target: `http://localhost:${port}`,
        ssl: true,
        certificate: domain
      });
    }

    this.api.info(`Domain ${domain} configured for service ${name}`);
  }

  async handleAppScaling(data) {
    // Update proxy configuration if needed for scaling
    const { name, replicas } = data;
    const domainInfo = await this.domainRegistry.getDomainInfo(name);

    if (domainInfo) {
      await this.proxyConfigurator.updateRoute(domainInfo.domain, {
        loadBalancing: replicas > 1 ? 'round_robin' : 'single'
      });
    }
  }

  async handleServiceScaling(data) {
    // Similar to app scaling
    const { name, replicas } = data;
    const domainInfo = await this.domainRegistry.getDomainInfo(name);

    if (domainInfo) {
      await this.proxyConfigurator.updateRoute(domainInfo.domain, {
        loadBalancing: replicas > 1 ? 'round_robin' : 'single'
      });
    }
  }

  getLoadBalancerIP() {
    // Get the load balancer IP - this should come from config or discovery
    return this.config.loadBalancerIP || '127.0.0.1';
  }

  // API endpoints this plugin provides
  getApiRoutes() {
    return {
      'GET /api/domains': this.listDomains.bind(this),
      'POST /api/domains': this.createDomain.bind(this),
      'DELETE /api/domains/:domain': this.deleteDomain.bind(this),
      'GET /api/domains/:domain/ssl': this.getSSLCertificate.bind(this)
    };
  }

  async listDomains(req, res) {
    try {
      const domains = await this.domainRegistry.listDomains();
      res.json({ domains });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createDomain(req, res) {
    try {
      const { name, domain, type, target } = req.body;
      await this.domainRegistry.registerDomain(name, domain, { type, target });
      await this.dnsManager.configureDNS(domain, {
        type: 'A',
        value: this.getLoadBalancerIP(),
        ttl: 300
      });
      res.json({ success: true, domain });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteDomain(req, res) {
    try {
      const { domain } = req.params;
      await this.domainRegistry.unregisterDomain(domain);
      await this.dnsManager.removeDNS(domain);
      await this.proxyConfigurator.removeRoute(domain);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getSSLCertificate(req, res) {
    try {
      const { domain } = req.params;
      const cert = await this.certificateManager.getCertificate(domain);
      res.json({ certificate: cert });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async destroy() {
    // Clean up resources
    if (this.dnsManager) await this.dnsManager.destroy();
    if (this.certificateManager) await this.certificateManager.destroy();
    if (this.proxyConfigurator) await this.proxyConfigurator.destroy();
    if (this.domainRegistry) await this.domainRegistry.destroy();

    await super.destroy();
  }
}

module.exports = DomainManagerPlugin;