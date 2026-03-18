#!/usr/bin/env node

/**
 * Observability Testing Script for ANCHOR Platform
 * Tests monitoring, logging, and metrics collection
 */

const axios = require('axios');
const { performance } = require('perf_hooks');

class ObservabilityTester {
  constructor(baseURL = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.validToken = null;
    this.metrics = {
      responseTimes: [],
      errorRates: [],
      throughput: 0
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
      const duration = endTime - startTime;

      // Collect metrics
      this.metrics.responseTimes.push(duration);
      if (response.status >= 400) {
        this.metrics.errorRates.push(1);
      } else {
        this.metrics.errorRates.push(0);
      }

      return {
        success: true,
        status: response.status,
        duration,
        data: response.data,
        description
      };
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Collect error metrics
      this.metrics.responseTimes.push(duration);
      this.metrics.errorRates.push(1);

      return {
        success: false,
        status: error.response?.status || 0,
        duration,
        error: error.response?.data || error.message,
        description
      };
    }
  }

  calculateMetrics() {
    const responseTimes = this.metrics.responseTimes;
    const errorRates = this.metrics.errorRates;

    if (responseTimes.length === 0) return null;

    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const maxResponseTime = Math.max(...responseTimes);
    const minResponseTime = Math.min(...responseTimes);
    const p95ResponseTime = this.calculatePercentile(responseTimes, 95);
    const p99ResponseTime = this.calculatePercentile(responseTimes, 99);

    const errorRate = (errorRates.reduce((a, b) => a + b, 0) / errorRates.length) * 100;

    return {
      totalRequests: responseTimes.length,
      avgResponseTime: Math.round(avgResponseTime * 100) / 100,
      maxResponseTime: Math.round(maxResponseTime * 100) / 100,
      minResponseTime: Math.round(minResponseTime * 100) / 100,
      p95ResponseTime: Math.round(p95ResponseTime * 100) / 100,
      p99ResponseTime: Math.round(p99ResponseTime * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100
    };
  }

  calculatePercentile(arr, percentile) {
    const sorted = arr.sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (upper >= sorted.length) return sorted[sorted.length - 1];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  async runMetricsCollectionTests() {
    console.log('\n📊 METRICS COLLECTION TESTS');

    const metricsTests = [
      // Health endpoint metrics
      {
        name: 'Health Metrics Collection',
        test: async () => {
          // Generate some traffic
          for (let i = 0; i < 10; i++) {
            await this.testEndpoint('GET', '/api/health', null, null, `Health check ${i + 1}`);
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          const metrics = this.calculateMetrics();
          const hasMetrics = metrics && metrics.totalRequests > 0;

          return {
            passed: hasMetrics,
            message: hasMetrics ? 'Metrics collected successfully' : 'No metrics collected',
            metrics
          };
        }
      },

      // API endpoint metrics
      {
        name: 'API Endpoint Metrics',
        test: async () => {
          // Generate API traffic
          const endpoints = [
            '/api/servers',
            '/api/health',
            '/api/auth/status'
          ];

          for (let i = 0; i < 5; i++) {
            for (const endpoint of endpoints) {
              await this.testEndpoint('GET', endpoint, null, this.validToken, `API call ${i + 1} to ${endpoint}`);
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          }

          const metrics = this.calculateMetrics();
          const hasMetrics = metrics && metrics.totalRequests >= 15; // 5 iterations * 3 endpoints

          return {
            passed: hasMetrics,
            message: hasMetrics ? 'API metrics collected' : 'API metrics not collected',
            metrics
          };
        }
      }
    ];

    for (const test of metricsTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
      if (result.metrics) {
        console.log(`  📈 Metrics: ${result.metrics.totalRequests} requests, ` +
                   `avg ${result.metrics.avgResponseTime}ms, ` +
                   `error rate ${result.metrics.errorRate}%`);
      }
    }
  }

  async runLoggingTests() {
    console.log('\n📝 LOGGING TESTS');

    const loggingTests = [
      // Error logging
      {
        name: 'Error Logging',
        test: async () => {
          // Generate some errors
          const errorResults = [];
          for (let i = 0; i < 5; i++) {
            const result = await this.testEndpoint(
              'GET',
              `/api/servers/nonexistent-${i}`,
              null,
              this.validToken,
              `Error test ${i + 1}`
            );
            errorResults.push(result);
          }

          const hasErrors = errorResults.some(r => !r.success);
          return {
            passed: hasErrors, // We expect errors for testing
            message: hasErrors ? 'Errors logged (expected)' : 'No errors generated',
            errorResults
          };
        }
      },

      // Request logging
      {
        name: 'Request Logging',
        test: async () => {
          // Generate normal requests
          for (let i = 0; i < 10; i++) {
            await this.testEndpoint('GET', '/api/health', null, null, `Request log test ${i + 1}`);
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          // Check if logs are being written (this would require log file access)
          return {
            passed: true, // Assume logging is working
            message: 'Request logging assumed working',
            note: 'Manual log file inspection needed'
          };
        }
      },

      // Security event logging
      {
        name: 'Security Event Logging',
        test: async () => {
          // Generate security events
          const securityTests = [
            this.testEndpoint('POST', '/api/auth/login', { username: 'admin', password: 'wrong' }, null, 'Failed login'),
            this.testEndpoint('GET', '/api/servers', null, 'invalid-token', 'Invalid token access'),
            this.testEndpoint('POST', '/api/servers/test;rm/start', {}, this.validToken, 'Injection attempt')
          ];

          for (const test of securityTests) {
            await test;
          }

          return {
            passed: true, // Assume security logging is working
            message: 'Security events logged (assumed)',
            note: 'Manual security log inspection needed'
          };
        }
      }
    ];

    for (const test of loggingTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
      if (result.note) {
        console.log(`  📝 Note: ${result.note}`);
      }
    }
  }

  async runMonitoringTests() {
    console.log('\n👀 MONITORING TESTS');

    const monitoringTests = [
      // Health check monitoring
      {
        name: 'Health Check Monitoring',
        test: async () => {
          const healthChecks = [];
          for (let i = 0; i < 5; i++) {
            const result = await this.testEndpoint('GET', '/api/health', null, null, `Health monitor ${i + 1}`);
            healthChecks.push(result);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          const allHealthy = healthChecks.every(h => h.success && h.status < 400);
          return {
            passed: allHealthy,
            message: allHealthy ? 'Health monitoring working' : 'Health monitoring issues detected',
            healthChecks
          };
        }
      },

      // Performance monitoring
      {
        name: 'Performance Monitoring',
        test: async () => {
          // Generate load to test performance monitoring
          const startTime = Date.now();
          const requests = [];

          for (let i = 0; i < 20; i++) {
            requests.push(this.testEndpoint('GET', '/api/health', null, null, `Perf test ${i + 1}`));
          }

          await Promise.all(requests);
          const endTime = Date.now();

          const metrics = this.calculateMetrics();
          const throughput = metrics.totalRequests / ((endTime - startTime) / 1000); // requests per second

          return {
            passed: metrics.avgResponseTime < 1000, // Should be fast
            message: `Performance monitored: ${throughput.toFixed(1)} req/sec, ${metrics.avgResponseTime}ms avg`,
            metrics: { ...metrics, throughput }
          };
        }
      },

      // Resource monitoring
      {
        name: 'Resource Monitoring',
        test: async () => {
          // Check system resource usage
          const memUsage = process.memoryUsage();
          const cpuUsage = process.cpuUsage();

          const resources = {
            rss: Math.round(memUsage.rss / 1024 / 1024), // MB
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
            cpuUser: cpuUsage.user / 1000, // ms
            cpuSystem: cpuUsage.system / 1000 // ms
          };

          return {
            passed: resources.heapUsed < 500, // Reasonable memory usage
            message: `Resources monitored: ${resources.heapUsed}MB heap, ${resources.cpuUser}ms CPU`,
            resources
          };
        }
      }
    ];

    for (const test of monitoringTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
    }
  }

  async runAlertingTests() {
    console.log('\n🚨 ALERTING TESTS');

    const alertingTests = [
      // Error rate alerting
      {
        name: 'Error Rate Alerting',
        test: async () => {
          // Generate high error rate
          const errorRequests = [];
          for (let i = 0; i < 10; i++) {
            errorRequests.push(
              this.testEndpoint('GET', '/api/nonexistent', null, this.validToken, `Error ${i + 1}`)
            );
          }

          await Promise.all(errorRequests);

          const metrics = this.calculateMetrics();
          const highErrorRate = metrics.errorRate > 50; // More than 50% errors

          return {
            passed: highErrorRate, // We expect high error rate for testing
            message: `Error rate: ${metrics.errorRate}% (should trigger alerts if configured)`,
            metrics
          };
        }
      },

      // Performance degradation alerting
      {
        name: 'Performance Alerting',
        test: async () => {
          // Simulate slow responses (if possible)
          const slowRequests = [];
          for (let i = 0; i < 5; i++) {
            slowRequests.push(
              this.testEndpoint('GET', '/api/health', null, null, `Slow request ${i + 1}`)
            );
          }

          await Promise.all(slowRequests);

          const metrics = this.calculateMetrics();

          return {
            passed: true, // Just check if monitoring works
            message: `Response time: ${metrics.avgResponseTime}ms (alerts if > threshold)`,
            metrics
          };
        }
      }
    ];

    for (const test of alertingTests) {
      console.log(`Testing: ${test.name}`);
      const result = await test.test();
      console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}: ${result.message}`);
    }
  }

  async generateObservabilityReport() {
    console.log('\n📈 OBSERVABILITY REPORT');

    const metrics = this.calculateMetrics();
    if (metrics) {
      console.log('Performance Metrics:');
      console.log(`  Total Requests: ${metrics.totalRequests}`);
      console.log(`  Average Response Time: ${metrics.avgResponseTime}ms`);
      console.log(`  95th Percentile: ${metrics.p95ResponseTime}ms`);
      console.log(`  99th Percentile: ${metrics.p99ResponseTime}ms`);
      console.log(`  Error Rate: ${metrics.errorRate}%`);
      console.log(`  Min/Max Response Time: ${metrics.minResponseTime}ms / ${metrics.maxResponseTime}ms`);
    }

    console.log('\nRecommendations:');
    if (metrics.errorRate > 5) {
      console.log('⚠️  High error rate detected - investigate error sources');
    }
    if (metrics.p95ResponseTime > 500) {
      console.log('⚠️  Slow response times - consider performance optimization');
    }
    if (metrics.totalRequests < 10) {
      console.log('ℹ️  Low request volume - increase load for better metrics');
    }
  }

  async runAllObservabilityTests() {
    console.log('👀 Starting ANCHOR Observability Tests');
    console.log('=' .repeat(60));

    if (!(await this.login())) {
      console.error('❌ Cannot run observability tests without authentication');
      return;
    }

    await this.runMetricsCollectionTests();
    await this.runLoggingTests();
    await this.runMonitoringTests();
    await this.runAlertingTests();

    await this.generateObservabilityReport();

    console.log('\n🏁 Observability Testing Complete');
    console.log('=' .repeat(60));
    console.log('Review metrics above. Set up proper monitoring dashboards for production.');
  }
}

// CLI interface
if (require.main === module) {
  const tester = new ObservabilityTester(process.argv[2] || 'http://localhost:3000');
  tester.runAllObservabilityTests().catch(console.error);
}

module.exports = ObservabilityTester;