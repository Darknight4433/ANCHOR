/* eslint-env jest */

const request = require('supertest');
const APIServer = require('../src/APIServer.js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

describe('API Server (Auth)', () => {
  let apiServer;
  let adminToken;
  let developerToken;

  beforeAll(async () => {
    // Set up dummy config for tests
    process.env.ADMIN_USERNAME = 'admin_test';
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('test_password', 10);
    process.env.JWT_SECRET = 'test-secret-key-for-testing';

    apiServer = new APIServer({
      port: 3333,
      jwtSecret: process.env.JWT_SECRET
    });

    // Stub GameServerManager for routes that need it
    const mockGameServerManager = {
      listServersWithStatus: jest.fn().mockResolvedValue([]),
      createServer: jest.fn().mockResolvedValue({ id: 'test-server', name: 'test-server' }),
      stopServer: jest.fn().mockResolvedValue(true)
    };
    apiServer.registerGameServerRoutes(mockGameServerManager);
    apiServer.registerAuthRoutes();
    apiServer.registerHealthRoutes();

    // Generate test tokens
    adminToken = jwt.sign({ username: 'admin_test', role: 'admin' }, process.env.JWT_SECRET);
    developerToken = jwt.sign({ username: 'dev_test', role: 'developer' }, process.env.JWT_SECRET);
  });

  afterAll(async () => {
    await apiServer.stop();
  });

  // 1️⃣ BASIC FUNCTIONALITY TESTS
  describe('Basic Functionality', () => {
    it('GET /health should return 200 ok', async () => {
      const res = await request(apiServer.app).get('/health');
      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('ok');
      expect(res.body.timestamp).toBeDefined();
    });

    it('GET /api/health should return minimal info', async () => {
      const res = await request(apiServer.app).get('/api/health');
      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('healthy');
      expect(res.body.timestamp).toBeDefined();
      // Should NOT expose sensitive info like process counts
      expect(res.body.runningProcesses).toBeUndefined();
    });
  });

  // 2️⃣ AUTHENTICATION TESTS
  describe('Authentication', () => {
    it('POST /api/auth/login should issue token on correct credentials', async () => {
      const res = await request(apiServer.app)
        .post('/api/auth/login')
        .send({ username: 'admin_test', password: 'test_password' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toEqual(true);
      expect(res.body.token).toBeDefined();
    });

    it('POST /api/auth/login should reject bad password', async () => {
      const res = await request(apiServer.app)
        .post('/api/auth/login')
        .send({ username: 'admin_test', password: 'wrong' });

      expect(res.statusCode).toEqual(401);
    });

    it('GET /api/servers unprotected should return 401', async () => {
      const res = await request(apiServer.app).get('/api/servers');
      expect(res.statusCode).toEqual(401);
    });

    it('GET /api/servers with valid token should return 200', async () => {
      const res = await request(apiServer.app)
        .get('/api/servers')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toEqual(200);
      expect(Array.isArray(res.body.servers)).toBe(true);
    });
  });

  // 3️⃣ AUTHORIZATION (RBAC) TESTS
  describe('Authorization (RBAC)', () => {
    it('Admin should access all endpoints', async () => {
      const res = await request(apiServer.app)
        .get('/api/servers')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toEqual(200);
    });

    it('Developer should access allowed endpoints', async () => {
      const res = await request(apiServer.app)
        .get('/api/servers')
        .set('Authorization', `Bearer ${developerToken}`);

      expect(res.statusCode).toEqual(200);
    });

    it('Viewer should be denied server management', async () => {
      const viewerToken = jwt.sign({ username: 'viewer_test', role: 'viewer' }, process.env.JWT_SECRET);

      const res = await request(apiServer.app)
        .post('/api/servers/test/start')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ type: 'minecraft' });

      expect(res.statusCode).toEqual(403);
      expect(res.body.error).toContain('Insufficient permissions');
    });
  });

  // 4️⃣ SECURITY TESTS
  describe('Security Tests', () => {
    it('Should reject command injection attempts', async () => {
      const maliciousPayload = {
        name: 'test; rm -rf /',
        type: 'minecraft'
      };

      const res = await request(apiServer.app)
        .post('/api/servers/test/start')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(maliciousPayload);

      expect(res.statusCode).toEqual(400);
    });

    it('Should reject SQL injection in names', async () => {
      const maliciousName = "test' OR '1'='1";

      const res = await request(apiServer.app)
        .post('/api/servers/' + maliciousName + '/start')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'minecraft' });

      expect(res.statusCode).toEqual(400);
    });

    it('Should enforce rate limiting on auth endpoints', async () => {
      // Send multiple rapid requests
      const promises = [];
      for (let i = 0; i < 15; i++) {
        promises.push(
          request(apiServer.app)
            .post('/api/auth/login')
            .send({ username: 'admin_test', password: 'wrong_password' })
        );
      }

      const results = await Promise.all(promises);
      const rateLimited = results.some(res => res.statusCode === 429);
      expect(rateLimited).toBe(true);
    });

    it('Should validate input properly', async () => {
      const invalidPayloads = [
        { name: '', type: 'minecraft' }, // empty name
        { name: 'a'.repeat(300), type: 'minecraft' }, // too long
        { name: 'test<script>', type: 'minecraft' }, // XSS attempt
        { name: 'test../../../etc/passwd', type: 'minecraft' } // path traversal
      ];

      for (const payload of invalidPayloads) {
        const res = await request(apiServer.app)
          .post('/api/servers/test/start')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(payload);

        expect(res.statusCode).toBeGreaterThanOrEqual(400);
      }
    });
  });

  // 5️⃣ INTEGRATION TESTS
  describe('Integration Tests', () => {
    it('Should handle full server lifecycle', async () => {
      // Create server
      const createRes = await request(apiServer.app)
        .post('/api/servers/test-server/start')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'minecraft' });

      expect(createRes.statusCode).toBeLessThan(400);

      // Stop server
      const stopRes = await request(apiServer.app)
        .post('/api/servers/test-server/stop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ force: false });

      expect(stopRes.statusCode).toBeLessThan(400);
    });

    it('Should handle plugin operations', async () => {
      // List plugins
      const listRes = await request(apiServer.app)
        .get('/api/plugins')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listRes.statusCode).toEqual(200);
      expect(Array.isArray(listRes.body.plugins)).toBe(true);
    });
  });

  describe('Security Tests', () => {
    it('POST /api/auth/login with wrong password should return 401', async () => {
      const res = await request(apiServer.app)
        .post('/api/auth/login')
        .send({ username: 'admin_test', password: 'wrong' });

      expect(res.statusCode).toEqual(401);
    });

    it('GET /api/servers unprotected should return 401', async () => {
      const res = await request(apiServer.app).get('/api/servers');
      expect(res.statusCode).toEqual(401);
    });

    it('GET /api/servers with token should return 200', async () => {
      const token = jwt.sign({ username: 'admin_test', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
      const res = await request(apiServer.app)
        .get('/api/servers')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body.servers).toEqual([]);
    });
  });
});
