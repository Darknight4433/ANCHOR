#!/usr/bin/env node

/**
 * Load Testing Script for ANCHOR Platform
 * Tests system performance under various loads
 */

const axios = require('axios');
const { performance } = require('perf_hooks');

class LoadTester {
  constructor(baseURL = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.token = null;
  }

  async login() {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/login`, {
        username: process.env.ADMIN_USERNAME || 'admin',
        password: process.env.ADMIN_PASSWORD || 'admin'
      });

      this.token = response.data.token;
      console.log('✅ Login successful');
      return true;
    } catch (error) {
      console.error('❌ Login failed:', error.response?.data || error.message);
      return false;
    }
  }

  async makeRequest(method, endpoint, data = null) {
    const startTime = performance.now();

    try {
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        }
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      const endTime = performance.now();
      const duration = endTime - startTime;

      return {
        success: true,
        status: response.status,
        duration,
        data: response.data
      };
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      return {
        success: false,
        status: error.response?.status || 0,
        duration,
        error: error.response?.data || error.message
      };
    }
  }

  async runHealthCheckLoadTest(requests = 100, concurrency = 10) {
    console.log(`\n🩺 Running Health Check Load Test`);
    console.log(`Requests: ${requests}, Concurrency: ${concurrency}`);

    const results = [];
    const batches = Math.ceil(requests / concurrency);

    for (let batch = 0; batch < batches; batch++) {
      const batchPromises = [];

      for (let i = 0; i < concurrency && (batch * concurrency + i) < requests; i++) {
        batchPromises.push(this.makeRequest('GET', '/api/health'));
      }

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    this.analyzeResults(results, 'Health Check Load Test');
  }

  async runAuthLoadTest(requests = 50) {
    console.log(`\n🔐 Running Authentication Load Test`);
    console.log(`Requests: ${requests}`);

    const results = [];

    for (let i = 0; i < requests; i++) {
      // Mix of valid and invalid logins
      const isValid = Math.random() > 0.3; // 70% valid, 30% invalid
      const username = isValid ? (process.env.ADMIN_USERNAME || 'admin') : 'wrong_user';
      const password = isValid ? (process.env.ADMIN_PASSWORD || 'admin') : 'wrong_pass';

      const startTime = performance.now();

      try {
        const response = await axios.post(`${this.baseURL}/api/auth/login`, {
          username,
          password
        });

        const endTime = performance.now();
        results.push({
          success: true,
          status: response.status,
          duration: endTime - startTime,
          type: isValid ? 'valid' : 'invalid'
        });
      } catch (error) {
        const endTime = performance.now();
        results.push({
          success: false,
          status: error.response?.status || 0,
          duration: endTime - startTime,
          type: isValid ? 'valid' : 'invalid'
        });
      }
    }

    this.analyzeResults(results, 'Authentication Load Test');
  }

  async runServerManagementLoadTest(requests = 20) {
    console.log(`\n🎮 Running Server Management Load Test`);
    console.log(`Requests: ${requests}`);

    const results = [];

    for (let i = 0; i < requests; i++) {
      const serverName = `load-test-server-${i}`;

      // Create server
      const createResult = await this.makeRequest('POST', `/api/servers/${serverName}/start`, {
        type: 'minecraft'
      });

      results.push({
        ...createResult,
        operation: 'create',
        serverName
      });

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check status
      const statusResult = await this.makeRequest('GET', `/api/servers/${serverName}/status`);
      results.push({
        ...statusResult,
        operation: 'status',
        serverName
      });
    }

    this.analyzeResults(results, 'Server Management Load Test');
  }

  analyzeResults(results, testName) {
    const totalRequests = results.length;
    const successfulRequests = results.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;

    const durations = results.map(r => r.duration);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);

    const p95Duration = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)];
    const p99Duration = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.99)];

    console.log(`\n📊 ${testName} Results:`);
    console.log(`Total Requests: ${totalRequests}`);
    console.log(`Successful: ${successfulRequests} (${((successfulRequests/totalRequests)*100).toFixed(1)}%)`);
    console.log(`Failed: ${failedRequests} (${((failedRequests/totalRequests)*100).toFixed(1)}%)`);
    console.log(`Average Response Time: ${avgDuration.toFixed(2)}ms`);
    console.log(`Min Response Time: ${minDuration.toFixed(2)}ms`);
    console.log(`Max Response Time: ${maxDuration.toFixed(2)}ms`);
    console.log(`95th Percentile: ${p95Duration.toFixed(2)}ms`);
    console.log(`99th Percentile: ${p99Duration.toFixed(2)}ms`);

    // Status code breakdown
    const statusCodes = {};
    results.forEach(r => {
      statusCodes[r.status] = (statusCodes[r.status] || 0) + 1;
    });

    console.log(`Status Codes:`, statusCodes);

    // Performance assessment
    if (avgDuration > 1000) {
      console.log(`⚠️  WARNING: Average response time > 1s`);
    } else if (avgDuration > 500) {
      console.log(`⚠️  WARNING: Average response time > 500ms`);
    } else {
      console.log(`✅ Good performance`);
    }

    if (failedRequests > totalRequests * 0.05) {
      console.log(`❌ HIGH ERROR RATE: ${((failedRequests/totalRequests)*100).toFixed(1)}%`);
    } else {
      console.log(`✅ Acceptable error rate`);
    }
  }

  async runAllTests() {
    console.log('🚀 Starting ANCHOR Load Tests');
    console.log('=' .repeat(50));

    // Login first
    if (!(await this.login())) {
      console.error('❌ Cannot proceed without authentication');
      return;
    }

    // Run tests
    await this.runHealthCheckLoadTest(200, 20);
    await this.runAuthLoadTest(100);
    await this.runServerManagementLoadTest(10);

    console.log('\n🏁 Load Testing Complete');
    console.log('=' .repeat(50));
  }
}

// CLI interface
if (require.main === module) {
  const tester = new LoadTester(process.argv[2] || 'http://localhost:3000');
  tester.runAllTests().catch(console.error);
}

module.exports = LoadTester;