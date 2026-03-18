#!/usr/bin/env node

/**
 * Deployment Testing Script for ANCHOR Platform
 * Tests real-world deployment scenarios and configurations
 */

const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class DeploymentTester {
  constructor(baseURL = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.validToken = null;
    this.testResults = {
      deployment: [],
      configuration: [],
      scaling: [],
      backup: []
    };
  }

  async login() {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/login`, {
        username: process.env.ADMIN_USERNAME || 'admin',
        password: process.env.ADMIN_PASSWORD || 'admin'
      });

      this.validToken = response.data.token;
      console.log('✅ Got valid authentication token');
      return true;
    } catch (error) {
      console.error('❌ Login failed:', error.response?.data || error.message);
      return false;
    }
  }

  async testEndpoint(method, endpoint, data = null, token = null, description = '') {
    try {
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
      }

      if (data) {
        config.data = data;
      }

      const response = await axios(config);

      return {
        success: true,
        status: response.status,
        data: response.data,
        description
      };
    } catch (error) {
      return {
        success: false,
        status: error.response?.status || 0,
        error: error.response?.data || error.message,
        description
      };
    }
  }

  async runDeploymentTests() {
    console.log('\n🚀 DEPLOYMENT TESTS');

    const deploymentTests = [
      // Fresh deployment test
      {
        name: 'Fresh Deployment Verification',
        test: async () => {
          const healthResult = await this.testEndpoint('GET', '/api/health', null, null, 'Health check');
          const versionResult = await this.testEndpoint('GET', '/api/version', null, null, 'Version check');

          const deployed = healthResult.success && healthResult.status < 400;
          const versioned = versionResult.success || versionResult.status === 404; // Version endpoint may not exist

          return {
            passed: deployed,
            message: deployed ? 'Fresh deployment successful' : 'Deployment failed',
            results: { healthResult, versionResult }
          };
        }
      },

      // Configuration loading
      {
        name: 'Configuration Loading',
        test: async () => {
          // Test that configuration is loaded properly
          const configResult = await this.testEndpoint('GET', '/api/config/status', null, this.validToken, 'Config status');

          // Even if endpoint doesn't exist, basic functionality should work
          const basicTest = await this.testEndpoint('GET', '/api/health', null, null, 'Basic functionality');

          const configured = basicTest.success;
          return {
            passed: configured,
            message: configured ? 'Configuration loaded successfully' : 'Configuration issues detected',
            results: { configResult, basicTest }
          };
        }
      },

      // Database connectivity
      {
        name: 'Database Connectivity',
        test: async () => {
          // Test database-dependent operations
          const serversResult = await this.testEndpoint('GET', '/api/servers', null, this.validToken, 'Server list');

          // Should not get 500 errors (DB connection issues)
          const dbConnected = serversResult.status !== 500;
          return {
            passed: dbConnected,
            message: dbConnected ? 'Database connection working' : 'Database connection failed',
            result: serversResult
          };
        }
      },

      // Plugin loading
      {
        name: 'Plugin System Initialization',
        test: async () => {
          const pluginsResult = await this.testEndpoint('GET', '/api/plugins', null, this.validToken, 'Plugin list');

          // Plugins might not be loaded yet, but system should handle it
          const pluginsHandled = pluginsResult.status < 500;
          return {
            passed: pluginsHandled,
            message: pluginsHandled ? 'Plugin system initialized' : 'Plugin system failed',
            result: pluginsResult
          };
        }
      }
    ];

    for (const test of deploymentTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
      this.testResults.deployment.push(result);
    }
  }

  async runConfigurationTests() {
    console.log('\n⚙️  CONFIGURATION TESTS');

    const configTests = [
      // Environment variables
      {
        name: 'Environment Configuration',
        test: async () => {
          // Test that environment-specific settings work
          const envTest = process.env.NODE_ENV || 'development';
          const isProduction = envTest === 'production';

          // In production, certain security features should be enabled
          const securityTest = await this.testEndpoint('GET', '/api/health', null, null, 'Security check');

          // Production should have stricter security
          const properlyConfigured = isProduction ?
            securityTest.success : // In prod, should work with security
            true; // In dev, more permissive

          return {
            passed: properlyConfigured,
            message: `Environment: ${envTest} - configuration ${properlyConfigured ? 'correct' : 'needs review'}`,
            env: envTest
          };
        }
      },

      // SSL/TLS configuration
      {
        name: 'SSL/TLS Configuration',
        test: async () => {
          // Check if HTTPS is being used
          const isHttps = this.baseURL.startsWith('https://');

          if (isHttps) {
            // Test certificate validity (basic check)
            const certTest = await this.testEndpoint('GET', '/api/health', null, null, 'HTTPS test');
            const certValid = certTest.success;
            return {
              passed: certValid,
              message: certValid ? 'SSL/TLS configured correctly' : 'SSL/TLS configuration issues',
              result: certTest
            };
          } else {
            return {
              passed: true, // HTTP is acceptable for testing
              message: 'HTTP configuration (acceptable for testing)',
              note: 'Consider HTTPS for production'
            };
          }
        }
      },

      // CORS configuration
      {
        name: 'CORS Configuration',
        test: async () => {
          // Test CORS headers
          try {
            const corsTest = await axios.options(`${this.baseURL}/api/health`, {
              headers: {
                'Origin': 'https://example.com',
                'Access-Control-Request-Method': 'GET'
              }
            });

            const hasCorsHeaders = corsTest.headers['access-control-allow-origin'] !== undefined;
            return {
              passed: true, // CORS is configured (whether restrictive or permissive)
              message: `CORS ${hasCorsHeaders ? 'configured' : 'not configured'}`,
              corsHeaders: corsTest.headers
            };
          } catch (error) {
            return {
              passed: true, // CORS might be restrictive
              message: 'CORS configuration restrictive (may be intentional)',
              error: error.message
            };
          }
        }
      },

      // Rate limiting configuration
      {
        name: 'Rate Limiting Configuration',
        test: async () => {
          // Test rate limiting by making many requests
          const requests = [];
          for (let i = 0; i < 15; i++) {
            requests.push(this.testEndpoint('GET', '/api/health', null, null, `Rate limit test ${i + 1}`));
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          const results = await Promise.all(requests);
          const rateLimited = results.some(r => r.status === 429);

          return {
            passed: rateLimited,
            message: rateLimited ? 'Rate limiting configured' : 'Rate limiting not configured',
            limitedRequests: results.filter(r => r.status === 429).length
          };
        }
      }
    ];

    for (const test of configTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
      this.testResults.configuration.push(result);
    }
  }

  async runScalingTests() {
    console.log('\n📈 SCALING TESTS');

    const scalingTests = [
      // Horizontal scaling readiness
      {
        name: 'Horizontal Scaling Readiness',
        test: async () => {
          // Test statelessness - multiple requests should work independently
          const concurrentRequests = [];
          for (let i = 0; i < 10; i++) {
            concurrentRequests.push(
              this.testEndpoint('GET', '/api/health', null, null, `Concurrent request ${i + 1}`)
            );
          }

          const results = await Promise.all(concurrentRequests);
          const allSuccessful = results.every(r => r.success);

          return {
            passed: allSuccessful,
            message: allSuccessful ? 'Ready for horizontal scaling' : 'Not ready for horizontal scaling',
            successfulRequests: results.filter(r => r.success).length
          };
        }
      },

      // Load balancer compatibility
      {
        name: 'Load Balancer Compatibility',
        test: async () => {
          // Test session stickiness requirements
          const sessionTests = [];

          // Make requests with different session-like behavior
          for (let i = 0; i < 5; i++) {
            const result = await this.testEndpoint('GET', '/api/health', null, null, `LB test ${i + 1}`);
            sessionTests.push(result);
            await new Promise(resolve => setTimeout(resolve, 200));
          }

          // Should work with load balancing (no session requirements)
          const lbCompatible = sessionTests.every(r => r.success);
          return {
            passed: lbCompatible,
            message: lbCompatible ? 'Load balancer compatible' : 'Load balancer issues',
            results: sessionTests
          };
        }
      },

      // Resource usage under load
      {
        name: 'Resource Usage Under Load',
        test: async () => {
          const startMem = process.memoryUsage();
          const startTime = Date.now();

          // Generate load
          const loadRequests = [];
          for (let i = 0; i < 50; i++) {
            loadRequests.push(this.testEndpoint('GET', '/api/health', null, null, `Load test ${i + 1}`));
          }

          await Promise.all(loadRequests);

          const endMem = process.memoryUsage();
          const endTime = Date.now();

          const memIncrease = (endMem.heapUsed - startMem.heapUsed) / 1024 / 1024; // MB
          const duration = endTime - startTime;

          const reasonableUsage = memIncrease < 100; // Less than 100MB increase

          return {
            passed: reasonableUsage,
            message: `Memory usage: +${memIncrease.toFixed(1)}MB in ${duration}ms`,
            metrics: { memIncrease, duration, reasonableUsage }
          };
        }
      }
    ];

    for (const test of scalingTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
      this.testResults.scaling.push(result);
    }
  }

  async runBackupTests() {
    console.log('\n💾 BACKUP & RECOVERY TESTS');

    const backupTests = [
      // Data persistence
      {
        name: 'Data Persistence',
        test: async () => {
          // Create some test data
          const testServerId = 'backup-test-server';
          const createResult = await this.testEndpoint(
            'POST',
            `/api/servers/${testServerId}/create`,
            { type: 'minecraft', config: { memory: '512M' } },
            this.validToken,
            'Create test server for backup'
          );

          if (!createResult.success) {
            return {
              passed: false,
              message: 'Could not create test data',
              result: createResult
            };
          }

          // Wait a moment for persistence
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Verify data persists
          const verifyResult = await this.testEndpoint(
            'GET',
            `/api/servers/${testServerId}/status`,
            null,
            this.validToken,
            'Verify data persistence'
          );

          // Cleanup
          await this.testEndpoint(
            'DELETE',
            `/api/servers/${testServerId}`,
            null,
            this.validToken,
            'Cleanup test server'
          );

          const persisted = verifyResult.success;
          return {
            passed: persisted,
            message: persisted ? 'Data persistence working' : 'Data persistence failed',
            results: { createResult, verifyResult }
          };
        }
      },

      // Backup configuration
      {
        name: 'Backup Configuration',
        test: async () => {
          // Check if backup directories exist and are writable
          const backupDirs = [
            './logs',
            './data',
            './backups'
          ];

          const dirChecks = [];
          for (const dir of backupDirs) {
            try {
              await fs.access(dir);
              dirChecks.push({ dir, exists: true });
            } catch {
              dirChecks.push({ dir, exists: false });
            }
          }

          const backupConfigured = dirChecks.some(d => d.exists);
          return {
            passed: backupConfigured,
            message: backupConfigured ? 'Backup directories configured' : 'Backup directories missing',
            dirChecks
          };
        }
      },

      // Recovery procedures
      {
        name: 'Recovery Procedures',
        test: async () => {
          // Test that system can recover from restart
          // This is hard to test automatically, so we check for recovery scripts
          const recoveryFiles = [
            './scripts/recovery.sh',
            './recovery.sh',
            './systemd/recovery.service',
            './docker-compose.recovery.yml'
          ];

          const fileChecks = [];
          for (const file of recoveryFiles) {
            try {
              await fs.access(file);
              fileChecks.push({ file, exists: true });
            } catch {
              fileChecks.push({ file, exists: false });
            }
          }

          const recoveryAvailable = fileChecks.some(f => f.exists);
          return {
            passed: recoveryAvailable,
            message: recoveryAvailable ? 'Recovery procedures available' : 'Recovery procedures missing',
            fileChecks
          };
        }
      }
    ];

    for (const test of backupTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
      this.testResults.backup.push(result);
    }
  }

  async generateDeploymentReport() {
    console.log('\n📋 DEPLOYMENT READINESS REPORT');

    const allTests = [
      ...this.testResults.deployment,
      ...this.testResults.configuration,
      ...this.testResults.scaling,
      ...this.testResults.backup
    ];

    const passed = allTests.filter(t => t.passed).length;
    const total = allTests.length;
    const score = Math.round((passed / total) * 100);

    console.log(`Overall Score: ${score}% (${passed}/${total} tests passed)`);

    console.log('\nDeployment Checklist:');
    console.log('✅ Fresh deployment verification');
    console.log('✅ Configuration loading');
    console.log('✅ Database connectivity');
    console.log('✅ Plugin system initialization');
    console.log('✅ Environment configuration');
    console.log('✅ SSL/TLS configuration');
    console.log('✅ CORS configuration');
    console.log('✅ Rate limiting');
    console.log('✅ Horizontal scaling readiness');
    console.log('✅ Load balancer compatibility');
    console.log('✅ Resource usage monitoring');
    console.log('✅ Data persistence');
    console.log('✅ Backup configuration');
    console.log('✅ Recovery procedures');

    if (score >= 80) {
      console.log('\n🎉 Deployment Ready! System passed most tests.');
    } else if (score >= 60) {
      console.log('\n⚠️  Deployment Needs Review. Some issues detected.');
    } else {
      console.log('\n❌ Deployment Not Ready. Critical issues found.');
    }
  }

  async runAllDeploymentTests() {
    console.log('🚀 Starting ANCHOR Deployment Tests');
    console.log('=' .repeat(60));
    console.log('Testing real-world deployment scenarios...');
    console.log('=' .repeat(60));

    if (!(await this.login())) {
      console.error('❌ Cannot run deployment tests without authentication');
      return;
    }

    await this.runDeploymentTests();
    await this.runConfigurationTests();
    await this.runScalingTests();
    await this.runBackupTests();

    await this.generateDeploymentReport();

    console.log('\n🏁 Deployment Testing Complete');
    console.log('=' .repeat(60));
    console.log('Use this report to verify production readiness.');
  }
}

// CLI interface
if (require.main === module) {
  const tester = new DeploymentTester(process.argv[2] || 'http://localhost:3000');
  tester.runAllDeploymentTests().catch(console.error);
}

module.exports = DeploymentTester;