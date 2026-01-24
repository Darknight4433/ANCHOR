const ProcessManager = require('../src/index.js');
const GameServerManager = require('../src/GameServerManager.js');
const DockerAdapter = require('../src/DockerAdapter.js');
const LogStreamService = require('../src/LogStreamService.js');
const APIServer = require('../src/APIServer.js');

/**
 * Platform Demo - Comprehensive showcase of Game Server Platform
 */

async function runDemo() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🎮 GAME SERVER PLATFORM - COMPREHENSIVE DEMO             ║
║                                                              ║
║ Phase 1: Process/Docker Management                          ║
║ Phase 2: Game Server Layer                                  ║
║ Phase 3: Log Streaming                                      ║
║ Phase 4: Web API & Dashboard                                ║
╚══════════════════════════════════════════════════════════════╝
  `);

  const pm = new ProcessManager();
  const docker = new DockerAdapter();
  const logs = new LogStreamService();
  const gameServers = new GameServerManager(pm, docker);
  const api = new APIServer({ port: 3000 });

  console.log('✓ Services initialized\n');

  // PHASE 1: CORE PROCESS MANAGEMENT
  console.log('═'.repeat(60));
  console.log('PHASE 1: Core Process Management');
  console.log('═'.repeat(60) + '\n');

  console.log('Starting test process...');
  const testProcess = pm.start('node', [
    '-e',
    'console.log("Process started"); setInterval(() => console.log("Running..."), 2000);'
  ], {
    name: 'test-process',
    stdio: 'pipe'
  });

  console.log(`✓ Process started: ${testProcess.name} (PID: ${testProcess.pid})\n`);

  // PHASE 2: GAME SERVER MANAGEMENT
  console.log('═'.repeat(60));
  console.log('PHASE 2: Game Server Management');
  console.log('═'.repeat(60) + '\n');

  console.log('Setting up server types...');
  gameServers.defineServerType('minecraft', {
    docker: 'itzg/minecraft-server:latest',
    ports: [{ host: '25565', container: '25565' }],
    volumes: [{ host: '/tmp/minecraft', container: '/data' }],
    env: { EULA: 'TRUE' },
    memory: '1g',
    cpus: '2'
  });

  gameServers.defineServerType('nodejs-app', {
    command: 'node',
    args: ['app.js'],
    cwd: '/opt/app',
    env: { NODE_ENV: 'production' },
    memory: '512m',
    cpus: '1'
  });

  console.log('✓ Server types configured');
  console.log('  - minecraft');
  console.log('  - nodejs-app\n');

  // PHASE 3: LOG STREAMING
  console.log('═'.repeat(60));
  console.log('PHASE 3: Log Streaming Service');
  console.log('═'.repeat(60) + '\n');

  console.log('Starting log service...');
  logs.startLogging('test-process', { persist: true });
  logs.write('test-process', 'Application initialized', 'info');
  logs.write('test-process', 'Database connected', 'info');
  logs.write('test-process', 'Server listening on port 8000', 'info');
  logs.write('test-process', 'High memory usage detected', 'warn');
  logs.write('test-process', 'Connection timeout', 'error');
  console.log('✓ Log entries written\n');

  const retrievedLogs = logs.getLogs('test-process', 100);
  console.log(`Retrieved ${retrievedLogs.length} log entries:`);
  retrievedLogs.slice(-5).forEach((log, idx) => {
    const icon = log.level === 'error' ? '❌' : log.level === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`  ${icon} [${log.level}] ${log.message}`);
  });
  console.log();

  // PHASE 4: REST API & WEBSOCKET
  console.log('═'.repeat(60));
  console.log('PHASE 4: REST API & WebSocket Features');
  console.log('═'.repeat(60) + '\n');

  console.log('API Server Capabilities:');
  console.log('  ✓ Authentication (JWT tokens)');
  console.log('  ✓ Game Server CRUD operations');
  console.log('  ✓ Real-time log streaming via WebSocket');
  console.log('  ✓ Resource limit management');
  console.log('  ✓ Server statistics and monitoring');
  console.log('  ✓ CORS support for web dashboard\n');

  console.log('API Endpoints:');
  const endpoints = [
    'POST   /api/servers                - Create server',
    'GET    /api/servers                - List servers',
    'GET    /api/servers/:name          - Get server status',
    'POST   /api/servers/:name/start    - Start server',
    'POST   /api/servers/:name/stop     - Stop server',
    'POST   /api/servers/:name/restart  - Restart server',
    'DELETE /api/servers/:name          - Delete server',
    'GET    /api/servers/:name/logs     - Get server logs',
    'POST   /api/servers/:name/limits   - Set resource limits',
    'POST   /api/auth/login             - Login (get JWT token)',
    'GET    /api/auth/verify            - Verify token',
    'GET    /health                     - Health check'
  ];
  endpoints.forEach(ep => console.log(`  ${ep}`));
  console.log();

  // PHASE 5: ARCHITECTURE OVERVIEW
  console.log('═'.repeat(60));
  console.log('PHASE 5: Platform Architecture');
  console.log('═'.repeat(60) + '\n');

  console.log(`
┌─────────────────────────────────────────────────────┐
│              WEB DASHBOARD (Browser)                │
│   Login → Dashboard → Server Management → Logs      │
└────────────────────┬────────────────────────────────┘
                     │
                     ↓ HTTP/WebSocket
┌─────────────────────────────────────────────────────┐
│              REST API SERVER (Node.js)              │
│  Port 3000: API endpoints + WebSocket gateway       │
├──────────────┬──────────────┬──────────────┬────────┤
│ Auth Layer   │ Routing      │ Validation   │ CORS   │
└──────────────┴──────────────┴──────────────┴────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│           GAME SERVER MANAGER                       │
│  Orchestrates servers across multiple runtimes     │
├──────────────┬──────────────┬──────────────┬────────┤
│ Docker       │ Native       │ Resource     │ Config │
│ Containers   │ Processes    │ Limits       │ Mgmt   │
└──────────────┴──────────────┴──────────────┴────────┘
  `);

  // PHASE 6: USE CASES
  console.log('═'.repeat(60));
  console.log('PHASE 6: Real-World Use Cases');
  console.log('═'.repeat(60) + '\n');

  const useCases = [
    { title: 'Game Server Hosting Panel', features: ['Auto-scaling', 'Resource limits', 'Real-time monitoring'] },
    { title: 'Microservices Orchestration', features: ['Service discovery', 'Load balancing', 'Health checks'] },
    { title: 'Application Deployment', features: ['Zero-downtime restarts', 'Persistent state', 'Auto-recovery'] },
    { title: 'CI/CD Integration', features: ['Build management', 'Test execution', 'Deployment tracking'] }
  ];

  useCases.forEach((uc, idx) => {
    console.log(`${idx + 1}. ${uc.title}`);
    console.log(`   ${uc.features.join(' • ')}\n`);
  });

  // SUMMARY
  console.log('═'.repeat(60));
  console.log('Platform Features Summary');
  console.log('═'.repeat(60) + '\n');

  console.log(`
✅ Phase 1: Process/Docker Management
   - Start, stop, restart processes and containers
   - Resource limit enforcement

✅ Phase 2: Game Server Layer  
   - Multiple server type templates
   - Per-server configuration

✅ Phase 3: Log Streaming
   - Real-time log capture
   - Persistent log storage
   - WebSocket broadcasting

✅ Phase 4: Web Platform
   - REST API with full CRUD
   - JWT authentication
   - WebSocket real-time updates
   - Modern web dashboard

Ready for: Game server panels, Microservices, Deployment platforms
  `);

  // Cleanup
  console.log('\nCleaning up...');
  await pm.stop('test-process');
  logs.stopLogging('test-process');
  console.log('✓ Demo complete!\n');
}

runDemo().catch(console.error);
