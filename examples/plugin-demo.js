#!/usr/bin/env node

/**
 * Plugin Ecosystem Demo
 * Demonstrates ANCHOR's plugin system capabilities
 */

const APIServer = require('../src/APIServer.js');

async function demoPluginSystem() {
  console.log('🔌 ANCHOR Phase 7 - Plugin Ecosystem Demo');
  console.log('=========================================\n');

  // Create API server with plugins enabled
  const apiServer = new APIServer({
    port: 3000,
    pluginDir: './plugins'
  });

  // Mock game server manager
  const gameServerManager = {
    listServersWithStatus: async () => {
      return {
        'demo-minecraft': {
          name: 'demo-minecraft',
          type: 'minecraft',
          status: 'running',
          players: 5,
          maxPlayers: 20,
          nodeId: 'node-1',
          region: 'us-east'
        }
      };
    },
    startServer: async (name) => {
      console.log(`▶️ Starting server: ${name}`);
      return true;
    },
    stopServer: async (name) => {
      console.log(`⏹️ Stopping server: ${name}`);
      return true;
    },
    restartServer: async (name) => {
      console.log(`🔄 Restarting server: ${name}`);
      return true;
    }
  };

  // Register game server routes
  apiServer.registerGameServerRoutes(gameServerManager);

  // Start the server
  await apiServer.start();
  console.log('✅ API Server started on http://localhost:3000\n');

  console.log('🔌 Plugin System Features:');
  console.log('---------------------------');

  // Show loaded plugins
  setTimeout(() => {
    const plugins = apiServer.pluginManager.getPlugins();
    console.log(`📦 Loaded plugins: ${Object.keys(plugins).length}`);
    for (const [name, plugin] of Object.entries(plugins)) {
      console.log(`  • ${name} v${plugin.version} - ${plugin.description}`);
      console.log(`    Events: ${plugin.events.join(', ')}`);
    }
    console.log();
  }, 1000);

  // Simulate server events
  setTimeout(() => {
    console.log('🎮 Simulating server events...\n');

    // Server creation event
    apiServer.pluginManager.emitToPlugins('serverCreated', {
      serverId: 'demo-minecraft',
      type: 'minecraft',
      nodeId: 'node-1',
      region: 'us-east'
    });

    // Scaling event
    setTimeout(() => {
      apiServer.pluginManager.emitToPlugins('scalingUp', {
        originalServer: 'demo-minecraft',
        newServer: 'minecraft-scale-1',
        node: { nodeId: 'node-1' }
      });
    }, 2000);

    // Cost optimization event
    setTimeout(() => {
      apiServer.pluginManager.emitToPlugins('costOptimization', {
        serverId: 'old-server'
      });
    }, 4000);

  }, 2000);

  // Show analytics after events
  setTimeout(async () => {
    console.log('\n📊 Analytics Report:');
    console.log('-------------------');

    try {
      // Get analytics from the analytics plugin
      const analyticsPlugin = apiServer.pluginManager.plugins.get('anchor-analytics');
      if (analyticsPlugin) {
        const report = analyticsPlugin.generateReport();
        console.log(`Total runtime: ${Math.floor(report.details.runtime / 60)} minutes`);
        console.log(`Total servers: ${report.details.totalServers}`);
        console.log(`Scaling events: ${report.details.totalScalingEvents}`);
        console.log(`Cost savings: $${report.details.costSavings}`);
        console.log(`Peak players: ${report.details.peakConcurrentPlayers}`);
      } else {
        console.log('Analytics plugin not loaded');
      }
    } catch (error) {
      console.log('Analytics not available:', error.message);
    }

    console.log('\n🔌 Plugin API Demo:');
    console.log('-------------------');

    // Demonstrate plugin API calls
    const servers = await apiServer.pluginManager.getServers();
    console.log(`Current servers: ${Object.keys(servers).length}`);

    const scalingStats = apiServer.pluginManager.getScalingStats();
    console.log(`Scaling actions today: ${scalingStats.scalingActions24h}`);

  }, 7000);

  // Shutdown after demo
  setTimeout(async () => {
    console.log('\n🛑 Shutting down demo...');
    await apiServer.stop();
    console.log('✅ Demo completed!');
    console.log('\n💡 Plugin Development Tips:');
    console.log('• Extend Plugin base class');
    console.log('• Listen to events in this.events array');
    console.log('• Use api.* methods for platform integration');
    console.log('• Store config with this.getConfig() / this.setConfig()');
    console.log('• Log with api.info(), api.warn(), api.error()');
    process.exit(0);
  }, 10000);

  console.log('⏰ Demo will run for 10 seconds, watch the plugin events...\n');
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});

demoPluginSystem().catch((error) => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});