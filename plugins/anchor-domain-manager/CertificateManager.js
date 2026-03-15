const acme = require('acme-client');
const fs = require('fs').promises;
const path = require('path');

/**
 * Certificate Manager - handles SSL certificate generation and renewal
 * Uses Let's Encrypt ACME protocol
 */
class CertificateManager {
  constructor(api, config) {
    this.api = api;
    this.config = config;
    this.certDir = config.certDir || './certs';
    this.email = config.email || 'admin@anchor.dev';
    this.certificates = new Map();
  }

  async init() {
    // Ensure cert directory exists
    try {
      await fs.mkdir(this.certDir, { recursive: true });
    } catch (error) {
      this.api.error('Failed to create certificates directory:', error);
    }

    this.api.info('Certificate Manager initialized');
  }

  async requestCertificate(domain) {
    try {
      this.api.info(`Requesting SSL certificate for ${domain}`);

      // Create ACME client
      const client = new acme.Client({
        directoryUrl: acme.directory.letsencrypt.production,
        accountKey: await this.getAccountKey()
      });

      // Create CSR
      const [key, csr] = await acme.crypto.createCsr({
        commonName: domain,
        altNames: [domain]
      });

      // Request certificate
      const cert = await client.auto({
        csr,
        email: this.email,
        termsOfServiceAgreed: true,
        challengeCreateFn: this.createChallenge.bind(this),
        challengeRemoveFn: this.removeChallenge.bind(this)
      });

      // Save certificate and key
      const certPath = path.join(this.certDir, `${domain}.pem`);
      const keyPath = path.join(this.certDir, `${domain}.key`);

      await fs.writeFile(certPath, cert);
      await fs.writeFile(keyPath, key);

      // Store in memory
      this.certificates.set(domain, {
        cert: cert,
        key: key,
        expires: this.getCertExpiry(cert),
        path: certPath,
        keyPath: keyPath
      });

      this.api.info(`SSL certificate obtained for ${domain}`);
      return { cert, key };
    } catch (error) {
      this.api.error(`Failed to obtain certificate for ${domain}:`, error);
      throw error;
    }
  }

  async getAccountKey() {
    const accountKeyPath = path.join(this.certDir, 'account-key.pem');

    try {
      return await fs.readFile(accountKeyPath);
    } catch (error) {
      // Generate new account key
      this.api.info('Generating new ACME account key');
      const accountKey = await acme.crypto.createPrivateKey();
      await fs.writeFile(accountKeyPath, accountKey);
      return accountKey;
    }
  }

  async createChallenge(authz, challenge, keyAuthorization) {
    // For HTTP-01 challenge, we need to serve the key authorization
    // This would typically be handled by the proxy configurator
    this.api.info(`Creating challenge for ${authz.identifier.value}`);

    // Store challenge for proxy to serve
    this.challenges = this.challenges || new Map();
    this.challenges.set(`/.well-known/acme-challenge/${challenge.token}`, keyAuthorization);
  }

  async removeChallenge(authz, challenge) {
    this.api.info(`Removing challenge for ${authz.identifier.value}`);
    if (this.challenges) {
      this.challenges.delete(`/.well-known/acme-challenge/${challenge.token}`);
    }
  }

  getChallenge(token) {
    return this.challenges ? this.challenges.get(`/.well-known/acme-challenge/${token}`) : null;
  }

  async getCertificate(domain) {
    return this.certificates.get(domain);
  }

  getCertExpiry(cert) {
    // Parse certificate to get expiry date
    // This is a simplified implementation
    const certLines = cert.split('\n');
    const expiryLine = certLines.find(line => line.startsWith('Not After'));
    if (expiryLine) {
      return new Date(expiryLine.replace('Not After : ', ''));
    }
    return null;
  }

  async renewCertificate(domain) {
    const certInfo = this.certificates.get(domain);
    if (!certInfo) {
      throw new Error(`No certificate found for ${domain}`);
    }

    // Check if renewal is needed (30 days before expiry)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    if (certInfo.expires && certInfo.expires > thirtyDaysFromNow) {
      return; // No renewal needed
    }

    this.api.info(`Renewing certificate for ${domain}`);
    await this.requestCertificate(domain);
  }

  async destroy() {
    this.certificates.clear();
    this.api.info('Certificate Manager destroyed');
  }
}

module.exports = CertificateManager;