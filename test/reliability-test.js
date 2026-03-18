#!/usr/bin/env node

/**
 * Long-Term Reliability Testing Script for ANCHOR Platform
 * Tests system stability and performance over extended periods
 */

const axios = require('axios');
const fs = require('fs').promises;

class ReliabilityTester {
  constructor(baseURL = 'http://localhost:3000', durationMinutes = 60) {
    this.baseURL = baseURL;
    this.durationMs = durationMinutes * 60 * 1000;
    this.validToken = null;
    this.startTime = Date.now();
    this.endTime = this.startTime + this.durationMs;

    this.metrics = {
      uptime: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimes: [],
      errors: [],
      memoryUsage: [],
      cpuUsage: [],
      checkpoints: []
    };

    this.isRunning = false;
    this.testInterval = null;
    this.monitorInterval = null;
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
        },
        timeout: 10000 // 10 second timeout
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

      this.metrics.totalRequests++;
      this.metrics.successfulRequests++;
      this.metrics.responseTimes.push(duration);

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

      this.metrics.totalRequests++;
      this.metrics.failedRequests++;
      this.metrics.responseTimes.push(duration);
      this.metrics.errors.push({
        timestamp: new Date().toISOString(),
        endpoint,
        error: error.response?.data || error.message,
        status: error.response?.status || 0
      });

      return {
        success: false,
        status: error.response?.status || 0,
        duration,
        error: error.response?.data || error.message,
        description
      };
    }
  }

  async performHealthCheck() {
    const result = await this.testEndpoint('GET', '/api/health', null, null, 'Health check');
    if (result.success && result.status < 400) {
      this.metrics.uptime++;
    }
    return result;
  }

  async performApiTest() {
    const endpoints = [
      '/api/servers',
      '/api/health',
      '/api/auth/status'
    ];

    const results = [];
    for (const endpoint of endpoints) {
      const result = await this.testEndpoint('GET', endpoint, null, this.validToken, `API test: ${endpoint}`);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between requests
    }

    return results;
  }

  async performLoadTest() {
    // Simulate occasional load spikes
    const concurrentRequests = [];
    const numRequests = Math.floor(Math.random() * 10) + 5; // 5-15 concurrent requests

    for (let i = 0; i < numRequests; i++) {
      concurrentRequests.push(
        this.testEndpoint('GET', '/api/health', null, null, `Load test ${i + 1}`)
      );
    }

    const results = await Promise.all(concurrentRequests);
    return results;
  }

  async collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const metrics = {
      timestamp: new Date().toISOString(),
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
      },
      cpu: {
        user: cpuUsage.user / 1000, // ms
        system: cpuUsage.system / 1000 // ms
      }
    };

    this.metrics.memoryUsage.push(metrics.memory);
    this.metrics.cpuUsage.push(metrics.cpu);

    return metrics;
  }

  createCheckpoint() {
    const elapsed = Date.now() - this.startTime;
    const elapsedMinutes = Math.round(elapsed / 1000 / 60);

    const checkpoint = {
      timestamp: new Date().toISOString(),
      elapsedMinutes,
      uptime: this.metrics.uptime,
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      errorRate: this.metrics.totalRequests > 0 ?
        (this.metrics.failedRequests / this.metrics.totalRequests * 100).toFixed(2) : 0,
      avgResponseTime: this.metrics.responseTimes.length > 0 ?
        (this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length).toFixed(2) : 0,
      recentErrors: this.metrics.errors.slice(-5) // Last 5 errors
    };

    this.metrics.checkpoints.push(checkpoint);

    console.log(`📊 Checkpoint at ${elapsedMinutes} minutes:`);
    console.log(`   Uptime: ${checkpoint.uptime} checks`);
    console.log(`   Requests: ${checkpoint.totalRequests} (${checkpoint.successfulRequests} success, ${checkpoint.failedRequests} failed)`);
    console.log(`   Error Rate: ${checkpoint.errorRate}%`);
    console.log(`   Avg Response Time: ${checkpoint.avgResponseTime}ms`);

    if (checkpoint.recentErrors.length > 0) {
      console.log(`   Recent Errors: ${checkpoint.recentErrors.length}`);
    }

    return checkpoint;
  }

  async runTestCycle() {
    if (Date.now() >= this.endTime) {
      this.stop();
      return;
    }

    try {
      // Health check (every cycle)
      await this.performHealthCheck();

      // API tests (every 3 cycles)
      if (Math.random() < 0.33) {
        await this.performApiTest();
      }

      // Load tests (every 10 cycles)
      if (Math.random() < 0.1) {
        await this.performLoadTest();
      }

      // System metrics collection
      await this.collectSystemMetrics();

    } catch (error) {
      console.error('❌ Test cycle error:', error.message);
      this.metrics.errors.push({
        timestamp: new Date().toISOString(),
        type: 'test_cycle_error',
        error: error.message
      });
    }
  }

  async runMonitoringCycle() {
    if (Date.now() >= this.endTime) {
      return;
    }

    const elapsed = Date.now() - this.startTime;
    const elapsedMinutes = elapsed / 1000 / 60;

    // Create checkpoints every 5 minutes
    if (Math.floor(elapsedMinutes) % 5 === 0 && Math.floor(elapsed / 1000 / 60) > Math.floor((elapsed - 10000) / 1000 / 60)) {
      this.createCheckpoint();
    }

    // Memory usage warnings
    const recentMem = this.metrics.memoryUsage.slice(-1)[0];
    if (recentMem && recentMem.heapUsed > 500) { // 500MB threshold
      console.log(`⚠️  High memory usage detected: ${recentMem.heapUsed}MB heap used`);
    }

    // Error rate warnings
    const recentErrors = this.metrics.errors.filter(e =>
      Date.now() - new Date(e.timestamp).getTime() < 300000 // Last 5 minutes
    ).length;

    if (recentErrors > 10) {
      console.log(`⚠️  High error rate detected: ${recentErrors} errors in last 5 minutes`);
    }
  }

  start() {
    if (this.isRunning) {
      console.log('Test already running');
      return;
    }

    console.log('🏃 Starting Long-Term Reliability Test');
    console.log(`Duration: ${this.durationMs / 1000 / 60} minutes`);
    console.log(`End Time: ${new Date(this.endTime).toISOString()}`);
    console.log('=' .repeat(60));

    this.isRunning = true;

    // Test cycle every 10 seconds
    this.testInterval = setInterval(() => {
      this.runTestCycle();
    }, 10000);

    // Monitoring cycle every 30 seconds
    this.monitorInterval = setInterval(() => {
      this.runMonitoringCycle();
    }, 30000);

    // Initial checkpoint
    setTimeout(() => {
      this.createCheckpoint();
    }, 1000);
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('\n🛑 Stopping Long-Term Reliability Test');
    clearInterval(this.testInterval);
    clearInterval(this.monitorInterval);
    this.isRunning = false;

    this.generateFinalReport();
  }

  calculatePercentile(arr, percentile) {
    if (arr.length === 0) return 0;
    const sorted = arr.sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (upper >= sorted.length) return sorted[sorted.length - 1];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  generateFinalReport() {
    console.log('\n📈 FINAL RELIABILITY REPORT');
    console.log('=' .repeat(60));

    const totalTime = (Date.now() - this.startTime) / 1000 / 60; // minutes
    const uptimePercentage = this.metrics.uptime > 0 ? (this.metrics.uptime / (totalTime * 6)) * 100 : 0; // 6 checks per minute

    console.log(`Test Duration: ${totalTime.toFixed(1)} minutes`);
    console.log(`Uptime: ${uptimePercentage.toFixed(2)}%`);
    console.log(`Total Requests: ${this.metrics.totalRequests}`);
    console.log(`Successful Requests: ${this.metrics.successfulRequests}`);
    console.log(`Failed Requests: ${this.metrics.failedRequests}`);

    if (this.metrics.responseTimes.length > 0) {
      const avgResponseTime = this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length;
      const p95ResponseTime = this.calculatePercentile(this.metrics.responseTimes, 95);
      const p99ResponseTime = this.calculatePercentile(this.metrics.responseTimes, 99);

      console.log(`Average Response Time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`95th Percentile Response Time: ${p95ResponseTime.toFixed(2)}ms`);
      console.log(`99th Percentile Response Time: ${p99ResponseTime.toFixed(2)}ms`);
    }

    console.log(`Total Errors: ${this.metrics.errors.length}`);

    // Memory analysis
    if (this.metrics.memoryUsage.length > 0) {
      const avgMem = this.metrics.memoryUsage.reduce((acc, m) => ({
        heapUsed: acc.heapUsed + m.heapUsed,
        rss: acc.rss + m.rss
      }), { heapUsed: 0, rss: 0 });

      avgMem.heapUsed /= this.metrics.memoryUsage.length;
      avgMem.rss /= this.metrics.memoryUsage.length;

      console.log(`Average Memory Usage: ${avgMem.heapUsed.toFixed(1)}MB heap, ${avgMem.rss.toFixed(1)}MB RSS`);

      const maxMem = this.metrics.memoryUsage.reduce((max, m) => ({
        heapUsed: Math.max(max.heapUsed, m.heapUsed),
        rss: Math.max(max.rss, m.rss)
      }), { heapUsed: 0, rss: 0 });

      console.log(`Peak Memory Usage: ${maxMem.heapUsed}MB heap, ${maxMem.rss}MB RSS`);
    }

    // Reliability assessment
    console.log('\n🔍 RELIABILITY ASSESSMENT:');

    const errorRate = this.metrics.totalRequests > 0 ?
      (this.metrics.failedRequests / this.metrics.totalRequests) * 100 : 0;

    if (uptimePercentage >= 99.9) {
      console.log('✅ Excellent uptime (>99.9%)');
    } else if (uptimePercentage >= 99) {
      console.log('⚠️  Good uptime (99-99.9%)');
    } else {
      console.log('❌ Poor uptime (<99%)');
    }

    if (errorRate <= 1) {
      console.log('✅ Low error rate (≤1%)');
    } else if (errorRate <= 5) {
      console.log('⚠️  Moderate error rate (1-5%)');
    } else {
      console.log('❌ High error rate (>5%)');
    }

    // Save detailed report
    this.saveDetailedReport();

    console.log('\n🏁 Long-Term Reliability Testing Complete');
    console.log('Detailed report saved to reliability-report.json');
  }

  async saveDetailedReport() {
    const report = {
      testInfo: {
        startTime: new Date(this.startTime).toISOString(),
        endTime: new Date().toISOString(),
        durationMinutes: (Date.now() - this.startTime) / 1000 / 60,
        baseURL: this.baseURL
      },
      summary: {
        uptime: this.metrics.uptime,
        totalRequests: this.metrics.totalRequests,
        successfulRequests: this.metrics.successfulRequests,
        failedRequests: this.metrics.failedRequests,
        errorRate: this.metrics.totalRequests > 0 ?
          (this.metrics.failedRequests / this.metrics.totalRequests * 100) : 0,
        avgResponseTime: this.metrics.responseTimes.length > 0 ?
          this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length : 0
      },
      detailedMetrics: {
        responseTimes: this.metrics.responseTimes,
        errors: this.metrics.errors.slice(-100), // Last 100 errors
        memoryUsage: this.metrics.memoryUsage,
        cpuUsage: this.metrics.cpuUsage,
        checkpoints: this.metrics.checkpoints
      }
    };

    try {
      await fs.writeFile('reliability-report.json', JSON.stringify(report, null, 2));
      console.log('📄 Detailed report saved to reliability-report.json');
    } catch (error) {
      console.error('❌ Failed to save detailed report:', error.message);
    }
  }

  async runReliabilityTest() {
    console.log('🔬 Starting ANCHOR Long-Term Reliability Test');
    console.log('=' .repeat(60));

    if (!(await this.login())) {
      console.error('❌ Cannot run reliability test without authentication');
      return;
    }

    // Setup graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n⏹️  Received SIGINT, stopping test...');
      this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n⏹️  Received SIGTERM, stopping test...');
      this.stop();
      process.exit(0);
    });

    this.start();

    // Wait for test completion
    return new Promise((resolve) => {
      const checkCompletion = () => {
        if (!this.isRunning) {
          resolve();
        } else {
          setTimeout(checkCompletion, 1000);
        }
      };
      checkCompletion();
    });
  }
}

// CLI interface
if (require.main === module) {
  const duration = parseInt(process.argv[3]) || 60; // Default 60 minutes
  const tester = new ReliabilityTester(process.argv[2] || 'http://localhost:3000', duration);
  tester.runReliabilityTest().catch(console.error);
}

module.exports = ReliabilityTester;