#!/usr/bin/env node

/**
 * Global Load Balancing Demo
 *
 * This script demonstrates the intelligent player routing capabilities
 * of the ANCHOR platform's Global Load Balancer.
 *
 * Features demonstrated:
 * - Server registration across multiple regions
 * - Latency-based routing
 * - Load balancing algorithms
 * - Real-time statistics
 * - Player routing simulation
 */

const GlobalLoadBalancer = require('../src/GlobalLoadBalancer.js');

async function runLoadBalancingDemo() {
  console.log('🚀 ANCHOR Global Load Balancing Demo');
  console.log('=====================================\n');

  // Initialize load balancer with latency-based routing
  const loadBalancer = new GlobalLoadBalancer({
    latencyCheckInterval: 5000, // Check every 5 seconds for demo
    regionPriority: 'latency',
    enableGeoRouting: true
  });

  console.log('📊 Initializing Global Load Balancer...');
  console.log('   - Latency check interval: 5 seconds');
  console.log('   - Routing strategy: latency-based');
  console.log('   - Geo-routing: enabled\n');

  // Register servers across different regions
  console.log('🌍 Registering game servers across regions...\n');

  // First, add regions with endpoints for latency measurement
  const regions = [
    { id: 'us-east', name: 'US East', location: 'New York, NY', endpoint: 'us-east' },
    { id: 'us-west', name: 'US West', location: 'Los Angeles, CA', endpoint: 'us-west' },
    { id: 'us-central', name: 'US Central', location: 'Chicago, IL', endpoint: 'us-central' },
    { id: 'eu-west', name: 'EU West', location: 'London, UK', endpoint: 'eu-west' },
    { id: 'eu-central', name: 'EU Central', location: 'Frankfurt, Germany', endpoint: 'eu-central' },
    { id: 'ap-east', name: 'Asia Pacific East', location: 'Tokyo, Japan', endpoint: 'ap-east' },
    { id: 'ap-southeast', name: 'Asia Pacific Southeast', location: 'Singapore', endpoint: 'ap-southeast' },
    { id: 'sa-east', name: 'South America East', location: 'São Paulo, Brazil', endpoint: 'sa-east' }
  ];

  regions.forEach(region => {
    loadBalancer.addRegion(region.id, region);
  });

  // Start the load balancer to begin latency measurements
  loadBalancer.start();

  const servers = [
    // North America
    { id: 'na-east-1', region: 'us-east', maxPlayers: 1000, players: 200, endpoint: 'na-east-1.anchor.com' },
    { id: 'na-west-1', region: 'us-west', maxPlayers: 800, players: 150, endpoint: 'na-west-1.anchor.com' },
    { id: 'na-central-1', region: 'us-central', maxPlayers: 600, players: 300, endpoint: 'na-central-1.anchor.com' },

    // Europe
    { id: 'eu-west-1', region: 'eu-west', maxPlayers: 1200, players: 400, endpoint: 'eu-west-1.anchor.com' },
    { id: 'eu-central-1', region: 'eu-central', maxPlayers: 900, players: 250, endpoint: 'eu-central-1.anchor.com' },

    // Asia Pacific
    { id: 'ap-east-1', region: 'ap-east', maxPlayers: 1500, players: 600, endpoint: 'ap-east-1.anchor.com' },
    { id: 'ap-southeast-1', region: 'ap-southeast', maxPlayers: 1100, players: 350, endpoint: 'ap-southeast-1.anchor.com' },

    // South America
    { id: 'sa-east-1', region: 'sa-east', maxPlayers: 500, players: 100, endpoint: 'sa-east-1.anchor.com' }
  ];

  servers.forEach(server => {
    loadBalancer.registerServer(server.id, {
      region: server.region,
      maxPlayers: server.maxPlayers,
      players: server.players,
      endpoint: server.endpoint,
      status: 'running'
    });
    console.log(`   ✅ Registered ${server.id} in ${server.region} (${server.players}/${server.maxPlayers} players)`);
  });

  console.log('\n📈 Current Load Balancer Statistics:');
  const initialStats = loadBalancer.getStats();
  console.log(`   - Total servers: ${initialStats.totalServers}`);
  console.log(`   - Total capacity: ${initialStats.totalCapacity}`);
  console.log(`   - Total load: ${initialStats.totalLoad}`);
  console.log(`   - Average utilization: ${initialStats.averageUtilization.toFixed(1)}%`);
  console.log(`   - Regions: ${Object.keys(initialStats.regions).join(', ')}\n`);

  // Simulate player routing from different locations
  console.log('🎮 Simulating player routing from different locations...\n');

  const players = [
    { id: 'player_001', location: 'New York, US', expectedRegion: 'us-east' },
    { id: 'player_002', location: 'Los Angeles, US', expectedRegion: 'us-west' },
    { id: 'player_003', location: 'London, UK', expectedRegion: 'eu-west' },
    { id: 'player_004', location: 'Berlin, Germany', expectedRegion: 'eu-central' },
    { id: 'player_005', location: 'Tokyo, Japan', expectedRegion: 'ap-east' },
    { id: 'player_006', location: 'Singapore', expectedRegion: 'ap-southeast' },
    { id: 'player_007', location: 'São Paulo, Brazil', expectedRegion: 'sa-east' },
    { id: 'player_008', location: 'Chicago, US', expectedRegion: 'us-central' }
  ];

  for (const player of players) {
    try {
      const server = loadBalancer.routePlayer(player.id, {
        region: player.expectedRegion,
        gameType: 'battle-royale',
        playerCount: 1
      });

      if (server) {
        console.log(`   🎯 ${player.id} (${player.location}) → ${server.server.id} (${server.server.region})`);
        console.log(`      Endpoint: ${server.server.endpoint}, Load: ${server.server.players}/${server.server.maxPlayers}`);
      } else {
        console.log(`   ❌ ${player.id} (${player.location}) → No server available`);
      }
    } catch (error) {
      console.log(`   ❌ ${player.id} (${player.location}) → Error: ${error.message}`);
    }
  }

  console.log('\n⏱️  Waiting for latency measurements... (10 seconds)\n');

  // Wait for latency measurements
  await new Promise(resolve => setTimeout(resolve, 10000));

  console.log('📊 Updated Statistics after latency measurements:');
  const updatedStats = loadBalancer.getStats();
  console.log(`   - Total servers: ${updatedStats.totalServers}`);
  console.log(`   - Average latency: ${updatedStats.averageLatency.toFixed(0)}ms`);
  console.log(`   - Best performing region: ${updatedStats.bestRegion || 'N/A'}`);

  console.log('\n🏆 Region Performance Rankings:');
  Object.entries(updatedStats.regions).forEach(([region, data]) => {
    console.log(`   ${region}: ${data.averageLatency.toFixed(0)}ms avg latency, ${data.serverCount} servers`);
  });

  console.log('\n🔄 Simulating load changes and re-routing...\n');

  // Simulate load changes
  loadBalancer.updateServerLoad('na-east-1', 800); // High load
  loadBalancer.updateServerLoad('eu-west-1', 1000); // Very high load
  loadBalancer.updateServerLoad('ap-east-1', 200); // Low load

  console.log('   📈 Updated loads:');
  console.log('      na-east-1: 200 → 800 players');
  console.log('      eu-west-1: 400 → 1000 players');
  console.log('      ap-east-1: 600 → 200 players\n');

  // Re-route some players
  const reRoutePlayers = ['player_001', 'player_003', 'player_005'];

  for (const playerId of reRoutePlayers) {
    try {
      const server = loadBalancer.routePlayer(playerId, {
        region: null, // Let load balancer choose best
        gameType: 'battle-royale',
        playerCount: 1
      });

      if (server) {
        console.log(`   🔄 ${playerId} re-routed → ${server.server.id} (${server.server.region})`);
      }
    } catch (error) {
      console.log(`   ❌ ${playerId} re-routing failed: ${error.message}`);
    }
  }

  console.log('\n🎉 Global Load Balancing Demo Complete!');
  console.log('\nKey Features Demonstrated:');
  console.log('   ✅ Multi-region server registration');
  console.log('   ✅ Latency-based intelligent routing');
  console.log('   ✅ Load balancing with capacity management');
  console.log('   ✅ Real-time statistics and monitoring');
  console.log('   ✅ Dynamic load adjustment and re-routing');
  console.log('   ✅ Geographic routing optimization');

  console.log('\n💡 This enables ANCHOR to provide optimal gaming experiences');
  console.log('   globally by routing players to the best available servers based');
  console.log('   on latency, load, and regional preferences.\n');

  // Cleanup
  loadBalancer.stop();
}

if (require.main === module) {
  runLoadBalancingDemo().catch(console.error);
}

module.exports = { runLoadBalancingDemo };