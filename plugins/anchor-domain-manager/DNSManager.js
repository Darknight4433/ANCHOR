const axios = require('axios');

/**
 * DNS Manager - handles DNS record configuration
 * Supports multiple DNS providers (Cloudflare, Route53, etc.)
 */
class DNSManager {
  constructor(api, config) {
    this.api = api;
    this.config = config;
    this.provider = config.provider || 'cloudflare'; // Default to Cloudflare
    this.apiKey = config.apiKey;
    this.zoneId = config.zoneId;
  }

  async init() {
    this.api.info('DNS Manager initialized');
  }

  async configureDNS(domain, record) {
    try {
      switch (this.provider) {
        case 'cloudflare':
          await this.configureCloudflareDNS(domain, record);
          break;
        case 'route53':
          await this.configureRoute53DNS(domain, record);
          break;
        default:
          this.api.warn(`Unsupported DNS provider: ${this.provider}`);
      }
      this.api.info(`DNS record configured for ${domain}`);
    } catch (error) {
      this.api.error(`Failed to configure DNS for ${domain}:`, error);
      throw error;
    }
  }

  async configureCloudflareDNS(domain, record) {
    if (!this.apiKey || !this.zoneId) {
      throw new Error('Cloudflare API key and zone ID required');
    }

    const url = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/dns_records`;

    const response = await axios.post(url, {
      type: record.type,
      name: domain,
      content: record.value,
      ttl: record.ttl || 300,
      proxied: false
    }, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.data.success) {
      throw new Error(`Cloudflare API error: ${response.data.errors[0].message}`);
    }

    return response.data.result;
  }

  async configureRoute53DNS(domain, record) {
    // AWS Route53 implementation would go here
    this.api.warn('Route53 DNS configuration not implemented yet');
  }

  async removeDNS(domain) {
    try {
      // First find the record ID
      const records = await this.listDNSRecords(domain);
      const record = records.find(r => r.name === domain);

      if (record) {
        switch (this.provider) {
          case 'cloudflare':
            await this.removeCloudflareDNS(record.id);
            break;
        }
      }
      this.api.info(`DNS record removed for ${domain}`);
    } catch (error) {
      this.api.error(`Failed to remove DNS for ${domain}:`, error);
      throw error;
    }
  }

  async removeCloudflareDNS(recordId) {
    const url = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/dns_records/${recordId}`;

    const response = await axios.delete(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });

    if (!response.data.success) {
      throw new Error(`Cloudflare API error: ${response.data.errors[0].message}`);
    }
  }

  async listDNSRecords(domain) {
    const url = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/dns_records?name=${domain}`;

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });

    if (!response.data.success) {
      throw new Error(`Cloudflare API error: ${response.data.errors[0].message}`);
    }

    return response.data.result;
  }

  async destroy() {
    this.api.info('DNS Manager destroyed');
  }
}

module.exports = DNSManager;