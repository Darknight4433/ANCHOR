#!/usr/bin/env node

/**
 * Scaling Engine Demo
 * Demonstrates AI-powered auto-scaling capabilities
 */

const APIServer = require('../src/APIServer.js');
// If Logger.js does not exist, comment out or remove this line
// const logger = require('../src/Logger.js');

async function demoScalingEngine() {
console.log('🚀 ANCHOR Phase 6 - AI Scaling Engine Demo');
  console.log('==========================================\n');

  // Create API server with scaling enabled
  const apiServer = new APIServer({
    port: 3000,
    scalingCheckInterval: 5000, // Check every 5 seconds for demo
    scaleUpThreshold: 0.8,
    scaleDownThreshold: 0.3,
    idleTimeout: 30000, // 30 seconds for demo
    predictiveScaling: true
  });

  // Mock game server manager for demo
  const gameServerManager = {
    listServersWithStatus: async () => {
      // Simulate some servers with different loads
      return [
        {
          name: 'minecraft-main',
          type: 'minecraft',
          status: 'running',
          players: 15,
          maxPlayers: 20,
          region: 'us-east',
          image: 'itzg/minecraft-server', // Official Minecraft Docker image by itzg
          createdAt: Date.now() - 60000
        },
        {
          name: 'csgo-1', // Counter-Strike: Global Offensive server
          type: 'csgo',
          status: 'running',
          players: 2,
          maxPlayers: 10,
          region: 'us-east',
          image: 'cm2network/csgo', // Official CS:GO Docker image
          createdAt: Date.now() - 120000
        }
      ];
    },
    stopServer: async (name) => {
      console.log(`🛑 ScalingEngine: Stopped server ${name}`);
    }
  };

  // Register game server routes
  apiServer.registerGameServerRoutes(gameServerManager);

  // Start the server
  await apiServer.start();
  console.log('✅ API Server started on http://localhost:3000\n');

  // Demo scaling metrics recording
  console.log('📊 Recording scaling metrics...\n');

  // Simulate high load on minecraft server
  setTimeout(() => {
    console.log('🔥 Simulating high load on minecraft-main (15/20 players = 75%)');
    apiServer.scalingEngine.recordMetrics('minecraft-main', {
      players: 15,
      maxPlayers: 20,
      cpu: 70,
      memory: 4096
    });
  }, 2000);

  // Simulate even higher load (should trigger scale up)
  setTimeout(() => {
    console.log('🔥 Simulating critical load on minecraft-main (18/20 players = 90%)');
    apiServer.scalingEngine.recordMetrics('minecraft-main', {
      players: 18,
      maxPlayers: 20,
      cpu: 85,
      memory: 4096
    });
  }, 10000);

  // Simulate low load on csgo server
  setTimeout(() => {
    console.log('📉 Simulating low load on csgo-1 (2/10 players = 20%)');
    apiServer.scalingEngine.recordMetrics('csgo-1', {
      players: 2,
      maxPlayers: 10,
      cpu: 15,
      memory: 1024
    });
  }, 15000);

  // Check scaling stats
  setTimeout(async () => {
    console.log('\n📈 Scaling Engine Statistics:');
    const stats = apiServer.scalingEngine.getStats();
    console.log(JSON.stringify(stats, null, 2));

    console.log('\n🔮 Predictive Scaling for minecraft-main:');
    const prediction = apiServer.scalingEngine.getPredictiveScaling('minecraft-main');
    console.log(prediction ? JSON.stringify(prediction, null, 2) : 'No prediction data yet');

  }, 20000);

  // Shutdown after demo
  setTimeout(async () => {
    console.log('\n🛑 Shutting down demo...');
    await apiServer.stop();
    console.log('✅ Demo completed!');
    process.exit(0);
  }, 25000);

  console.log('⏰ Demo will run for 25 seconds, watch the scaling decisions...\n');
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});

demoScalingEngine().catch((error) => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});