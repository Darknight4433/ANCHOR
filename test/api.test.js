/* eslint-env jest */

const request = require('supertest');
const APIServer = require('../src/APIServer.js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

describe('API Server (Auth)', () => {
  let apiServer;
  
  beforeAll(async () => {
    // Set up dummy config for tests
    process.env.ADMIN_USERNAME = 'admin_test';
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('test_password', 10);
    
    apiServer = new APIServer({ 
      port: 3333,
      jwtSecret: 'test-secret'
    });
    
    // Stub GameServerManager for routes that need it
    const mockGameServerManager = {
      listServersWithStatus: jest.fn().mockResolvedValue([])
    };
    apiServer.registerGameServerRoutes(mockGameServerManager);
    apiServer.registerAuthRoutes();
    apiServer.registerHealthRoutes();
  });

  afterAll(async () => {
    await apiServer.stop();
  });

  it('GET /health should return 200 ok', async () => {
    const res = await request(apiServer.app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('ok');
  });

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
  
  it('GET /api/servers with token should return 200', async () => {
    const token = jwt.sign({ username: 'admin_test', role: 'admin' }, 'test-secret', { expiresIn: '1h' });
    const res = await request(apiServer.app)
      .get('/api/servers')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toEqual(200);
    expect(res.body.servers).toEqual([]);
  });
});
