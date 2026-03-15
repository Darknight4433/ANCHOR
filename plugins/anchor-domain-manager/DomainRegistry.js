const fs = require('fs').promises;

/**
 * Domain Registry - tracks domain registrations and mappings
 */
class DomainRegistry {
  constructor(api, config) {
    this.api = api;
    this.config = config;
    this.registryFile = config.registryFile || './domain-registry.json';
    this.domains = new Map();
  }

  async init() {
    // Load existing registry
    try {
      const data = await fs.readFile(this.registryFile, 'utf8');
      const registry = JSON.parse(data);
      this.domains = new Map(Object.entries(registry));
      this.api.info(`Loaded ${this.domains.size} domain registrations`);
    } catch (error) {
      // Registry doesn't exist yet, start fresh
      this.api.info('Initializing new domain registry');
    }
  }

  async registerDomain(name, domain, metadata) {
    try {
      const registration = {
        name,
        domain,
        metadata,
        registeredAt: new Date().toISOString(),
        status: 'active'
      };

      this.domains.set(domain, registration);
      await this.saveRegistry();

      this.api.info(`Domain ${domain} registered for ${name}`);
      return registration;
    } catch (error) {
      this.api.error(`Failed to register domain ${domain}:`, error);
      throw error;
    }
  }

  async unregisterDomain(domain) {
    if (this.domains.has(domain)) {
      this.domains.delete(domain);
      await this.saveRegistry();
      this.api.info(`Domain ${domain} unregistered`);
    }
  }

  async getDomainInfo(domain) {
    return this.domains.get(domain);
  }

  async getDomainByName(name) {
    for (const [domain, info] of this.domains) {
      if (info.name === name) {
        return { domain, ...info };
      }
    }
    return null;
  }

  async listDomains() {
    return Array.from(this.domains.entries()).map(([domain, info]) => ({
      domain,
      ...info
    }));
  }

  async updateDomainStatus(domain, status) {
    const info = this.domains.get(domain);
    if (info) {
      info.status = status;
      info.updatedAt = new Date().toISOString();
      await this.saveRegistry();
    }
  }

  async saveRegistry() {
    const registry = Object.fromEntries(this.domains);
    await fs.writeFile(this.registryFile, JSON.stringify(registry, null, 2));
  }

  async destroy() {
    await this.saveRegistry();
    this.domains.clear();
    this.api.info('Domain Registry destroyed');
  }
}

module.exports = DomainRegistry;