/* eslint-env jest */

const request = require('supertest');
const APIServer = require('../src/APIServer.js');
const jwt = require('jsonwebtoken');

describe('Integration Tests - Full System', () => {
  let apiServer;
  let adminToken;

  beforeAll(async () => {
    // Setup environment
    process.env.ADMIN_USERNAME = 'admin_test';
    process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('test_password', 10);
    process.env.JWT_SECRET = 'integration-test-secret';

    // Create API server
    apiServer = new APIServer({
      port: 3334,
      jwtSecret: process.env.JWT_SECRET
    });

    // Setup routes
    const mockGameServerManager = {
      listServersWithStatus: jest.fn().mockResolvedValue([]),
      createServer: jest.fn().mockResolvedValue({
        id: 'integration-test-server',
        name: 'integration-test-server',
        status: 'running'
      }),
      stopServer: jest.fn().mockResolvedValue(true),
      getServerStatus: jest.fn().mockResolvedValue({
        name: 'integration-test-server',
        status: 'running',
        uptime: 300000
      })
    };

    apiServer.registerGameServerRoutes(mockGameServerManager);
    apiServer.registerAuthRoutes();
    apiServer.registerHealthRoutes();

    // Generate admin token
    adminToken = jwt.sign({ username: 'admin_test', role: 'admin' }, process.env.JWT_SECRET);
  });

  afterAll(async () => {
    await apiServer.stop();
  });

  describe('End-to-End Server Management', () => {
    it('Should complete full server lifecycle', async () => {
      const serverName = 'integration-test-server';

      // 1. Login
      const loginRes = await request(apiServer.app)
        .post('/api/auth/login')
        .send({ username: 'admin_test', password: 'test_password' });

      expect(loginRes.statusCode).toEqual(200);
      expect(loginRes.body.token).toBeDefined();

      const token = loginRes.body.token;

      // 2. Start server
      const startRes = await request(apiServer.app)
        .post(`/api/servers/${serverName}/start`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'minecraft' });

      expect(startRes.statusCode).toBeLessThan(400);

      // 3. Check server status
      const statusRes = await request(apiServer.app)
        .get(`/api/servers/${serverName}/status`)
        .set('Authorization', `Bearer ${token}`);

      expect(statusRes.statusCode).toEqual(200);
      expect(statusRes.body.status).toBeDefined();

      // 4. Stop server
      const stopRes = await request(apiServer.app)
        .post(`/api/servers/${serverName}/stop`)
        .set('Authorization', `Bearer ${token}`)
        .send({ force: false });

      expect(stopRes.statusCode).toBeLessThan(400);
    });

    it('Should handle concurrent requests', async () => {
      const requests = [];

      // Create multiple concurrent requests
      for (let i = 0; i < 5; i++) {
        requests.push(
          request(apiServer.app)
            .get('/api/health')
            .set('Authorization', `Bearer ${adminToken}`)
        );
      }

      const results = await Promise.all(requests);

      // All should succeed
      results.forEach(res => {
        expect(res.statusCode).toEqual(200);
      });
    });
  });

  describe('Plugin System Integration', () => {
    it('Should handle plugin marketplace operations', async () => {
      // List marketplace plugins
      const marketplaceRes = await request(apiServer.app)
        .get('/api/plugins/marketplace')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(marketplaceRes.statusCode).toEqual(200);

      // Search plugins
      const searchRes = await request(apiServer.app)
        .get('/api/plugins/marketplace/search?q=analytics')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(searchRes.statusCode).toEqual(200);
    });
  });

  describe('Load Balancing Integration', () => {
    it('Should handle load balancer operations', async () => {
      // Get regions
      const regionsRes = await request(apiServer.app)
        .get('/api/loadbalancer/regions')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(regionsRes.statusCode).toEqual(200);

      // Get servers
      const serversRes = await request(apiServer.app)
        .get('/api/loadbalancer/servers')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(serversRes.statusCode).toEqual(200);
    });
  });

  describe('Metrics and Monitoring', () => {
    it('Should expose metrics endpoint', async () => {
      const metricsRes = await request(apiServer.app)
        .get('/api/metrics')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(metricsRes.statusCode).toEqual(200);
      expect(metricsRes.body.uptime).toBeDefined();
      expect(metricsRes.body.memory).toBeDefined();
      expect(metricsRes.body.nodeCount).toBeDefined();
    });
  });
});