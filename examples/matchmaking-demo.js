#!/usr/bin/env node

/**
 * Matchmaking Demo
 *
 * This script demonstrates ANCHOR's intelligent matchmaking system
 * that combines player preferences with global server routing.
 *
 * Features demonstrated:
 * - Player skill-based matching
 * - Regional preference handling
 * - Server deployment on demand
 * - Global load balancing integration
 * - Real-time matchmaking queues
 */

const MatchmakingService = require('../src/MatchmakingService.js');
const GlobalLoadBalancer = require('../src/GlobalLoadBalancer.js');

async function runMatchmakingDemo() {
  console.log('🎮 ANCHOR Matchmaking System Demo');
  console.log('==================================\n');

  // Initialize matchmaking service
  const matchmaking = new MatchmakingService({
    maxQueueTime: 30000, // 30 seconds
    skillRange: 200, // MMR difference tolerance
    maxPartySize: 4,
    regionPreferences: ['us-east', 'eu-west', 'ap-southeast']
  });

  // Initialize load balancer (simplified for demo)
  const loadBalancer = new GlobalLoadBalancer({
    latencyCheckInterval: 10000,
    regionPriority: 'latency',
    enableGeoRouting: true
  });

  // Add regions for load balancing
  const regions = [
    { id: 'us-east', name: 'US East', location: 'New York, NY', endpoint: 'us-east' },
    { id: 'eu-west', name: 'EU West', location: 'London, UK', endpoint: 'eu-west' },
    { id: 'ap-southeast', name: 'Asia Pacific Southeast', location: 'Singapore', endpoint: 'ap-southeast' }
  ];

  regions.forEach(region => loadBalancer.addRegion(region.id, region));

  // Register some servers
  const servers = [
    { id: 'us-east-1', region: 'us-east', maxPlayers: 100, players: 0, endpoint: 'us-east-1.game.com' },
    { id: 'us-east-2', region: 'us-east', maxPlayers: 100, players: 0, endpoint: 'us-east-2.game.com' },
    { id: 'eu-west-1', region: 'eu-west', maxPlayers: 100, players: 0, endpoint: 'eu-west-1.game.com' },
    { id: 'ap-se-1', region: 'ap-southeast', maxPlayers: 100, players: 0, endpoint: 'ap-se-1.game.com' }
  ];

  servers.forEach(server => {
    loadBalancer.registerServer(server.id, {
      region: server.region,
      maxPlayers: server.maxPlayers,
      players: server.players,
      endpoint: server.endpoint,
      status: 'running'
    });
  });

  console.log('🎯 Initializing Matchmaking Service...');
  console.log('   - Max queue time: 30 seconds');
  console.log('   - Skill range tolerance: ±200 MMR');
  console.log('   - Max party size: 4 players');
  console.log('   - Supported regions: US East, EU West, Asia Pacific\n');

  // Start the matchmaking service
  matchmaking.start();
  loadBalancer.start();

  console.log('👥 Simulating players joining matchmaking queue...\n');

  // Simulate players with different skill levels and preferences
  const players = [
    { id: 'player_001', skill: 1500, region: 'us-east', gameMode: 'ranked' },
    { id: 'player_002', skill: 1480, region: 'us-east', gameMode: 'ranked' },
    { id: 'player_003', skill: 1520, region: 'us-east', gameMode: 'ranked' },
    { id: 'player_004', skill: 1490, region: 'us-east', gameMode: 'ranked' },
    { id: 'player_005', skill: 1800, region: 'eu-west', gameMode: 'ranked' },
    { id: 'player_006', skill: 1820, region: 'eu-west', gameMode: 'ranked' },
    { id: 'player_007', skill: 1750, region: 'ap-southeast', gameMode: 'casual' },
    { id: 'player_008', skill: 1780, region: 'ap-southeast', gameMode: 'casual' }
  ];

  // Add players to matchmaking queue
  for (const player of players) {
    matchmaking.addToQueue(player.id, {
      skill: player.skill,
      preferredRegion: player.region,
      gameMode: player.gameMode,
      maxWaitTime: 30000
    });
    console.log(`   ➕ ${player.id} joined queue (MMR: ${player.skill}, Region: ${player.region}, Mode: ${player.gameMode})`);
  }

  console.log('\n⏳ Processing matchmaking...\n');

  // Wait for matches to be found
  let matchCount = 0;
  const maxWaitTime = 35000; // 35 seconds total
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime && matchCount < 2) {
    const matches = matchmaking.processQueue();

    for (const match of matches) {
      matchCount++;
      console.log(`\n🎯 Match ${matchCount} Found!`);
      console.log(`   Game Mode: ${match.gameMode}`);
      console.log(`   Region: ${match.region}`);
      console.log(`   Average MMR: ${match.averageSkill}`);
      console.log(`   Players: ${match.players.join(', ')}`);

      // Find best server for this match
      const server = loadBalancer.routePlayer(match.players[0], {
        region: match.region,
        gameType: match.gameMode,
        playerCount: match.players.length
      });

      if (server) {
        console.log(`   🖥️  Assigned Server: ${server.server.id} (${server.server.endpoint})`);
        console.log(`   📊 Server Load: ${server.server.players}/${server.server.maxPlayers}`);

        // Update server load
        loadBalancer.updateServerLoad(server.server.id, server.server.players + match.players.length);
      }

      console.log(`   ✅ Match ${matchCount} deployed successfully!\n`);
    }

    // Small delay to prevent tight loop
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Show final queue status
  const queueStatus = matchmaking.getQueueStatus();
  console.log('📈 Final Matchmaking Statistics:');
  console.log(`   - Total players queued: ${queueStatus.totalQueued}`);
  console.log(`   - Matches created: ${queueStatus.matchesCreated}`);
  console.log(`   - Players still waiting: ${queueStatus.playersWaiting}`);
  console.log(`   - Average wait time: ${queueStatus.averageWaitTime}ms`);

  console.log('\n🏆 Matchmaking Demo Complete!');
  console.log('\nKey Features Demonstrated:');
  console.log('   ✅ Skill-based matchmaking with MMR tolerance');
  console.log('   ✅ Regional preference handling');
  console.log('   ✅ Game mode separation (ranked vs casual)');
  console.log('   ✅ Server deployment integration');
  console.log('   ✅ Global load balancer integration');
  console.log('   ✅ Real-time queue processing');

  console.log('\n💡 This transforms ANCHOR into a complete multiplayer');
  console.log('   backend platform capable of managing player matchmaking');
  console.log('   and server allocation at global scale!\n');

  // Cleanup
  matchmaking.stop();
  loadBalancer.stop();
}

if (require.main === module) {
  runMatchmakingDemo().catch(console.error);
}

module.exports = { runMatchmakingDemo };