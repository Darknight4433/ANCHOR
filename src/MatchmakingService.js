const EventEmitter = require('events');
const logger = require('./Logger.js');

/**
 * MatchmakingService - Intelligent player matchmaking system
 *
 * Features:
 * - Skill-based matching with MMR tolerance
 * - Regional preference handling
 * - Game mode separation
 * - Queue time management
 * - Server allocation integration
 */
class MatchmakingService extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      maxQueueTime: options.maxQueueTime || 30000, // 30 seconds
      skillRange: options.skillRange || 200, // MMR difference tolerance
      maxPartySize: options.maxPartySize || 4,
      regionPreferences: options.regionPreferences || ['us-east', 'eu-west', 'ap-southeast'],
      checkInterval: options.checkInterval || 1000, // Check every second
      ...options
    };

    this.queue = new Map(); // playerId -> player data
    this.matches = new Map(); // matchId -> match data
    this.interval = null;
    this.matchCounter = 0;

    // Statistics
    this.stats = {
      totalQueued: 0,
      matchesCreated: 0,
      playersMatched: 0,
      averageWaitTime: 0,
      totalWaitTime: 0
    };
  }

  /**
   * Start the matchmaking service
   */
  start() {
    logger.info('🎯 Starting Matchmaking Service');
    this.interval = setInterval(() => this.processQueue(), this.options.checkInterval);
    this.emit('started');
  }

  /**
   * Stop the matchmaking service
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('🎯 Stopped Matchmaking Service');
    this.emit('stopped');
  }

  /**
   * Add a player to the matchmaking queue
   */
  addToQueue(playerId, playerData) {
    const queueEntry = {
      playerId,
      skill: playerData.skill || 1000,
      preferredRegion: playerData.preferredRegion || 'us-east',
      gameMode: playerData.gameMode || 'casual',
      maxWaitTime: playerData.maxWaitTime || this.options.maxQueueTime,
      joinedAt: Date.now(),
      ...playerData
    };

    this.queue.set(playerId, queueEntry);
    this.stats.totalQueued++;

    logger.info(`👤 Player ${playerId} joined matchmaking queue (MMR: ${queueEntry.skill}, Region: ${queueEntry.preferredRegion})`);
    this.emit('playerQueued', { playerId, queueEntry });
  }

  /**
   * Remove a player from the queue
   */
  removeFromQueue(playerId) {
    const player = this.queue.get(playerId);
    if (player) {
      this.queue.delete(playerId);
      const waitTime = Date.now() - player.joinedAt;
      this.stats.totalWaitTime += waitTime;

      logger.info(`👤 Player ${playerId} left matchmaking queue (waited: ${waitTime}ms)`);
      this.emit('playerDequeued', { playerId, waitTime });
    }
  }

  /**
   * Process the matchmaking queue and create matches
   */
  processQueue() {
    const now = Date.now();
    const matches = [];

    // Group players by game mode and region
    const queuesByMode = this.groupPlayersByMode();

    // Process each game mode queue
    for (const [gameMode, regions] of queuesByMode) {
      for (const [region, players] of regions) {
        const newMatches = this.findMatches(players, gameMode, region, now);
        matches.push(...newMatches);
      }
    }

    // Remove expired players from queue
    this.removeExpiredPlayers(now);

    return matches;
  }

  /**
   * Group players by game mode and region
   */
  groupPlayersByMode() {
    const queuesByMode = new Map();

    // eslint-disable-next-line no-unused-vars
    for (const [_playerId, player] of this.queue) {
      const mode = player.gameMode;
      const region = player.preferredRegion;

      if (!queuesByMode.has(mode)) {
        queuesByMode.set(mode, new Map());
      }

      if (!queuesByMode.get(mode).has(region)) {
        queuesByMode.get(mode).set(region, []);
      }

      queuesByMode.get(mode).get(region).push(player);
    }

    return queuesByMode;
  }

  /**
   * Find matches in a group of players
   */
  findMatches(players, gameMode, region, now) {
    const matches = [];
    const usedPlayers = new Set();

    // Sort players by skill for better matching
    players.sort((a, b) => a.skill - b.skill);

    for (let i = 0; i < players.length; i++) {
      if (usedPlayers.has(players[i].playerId)) continue;

      const potentialMatch = [players[i]];
      usedPlayers.add(players[i].playerId);

      // Try to find suitable teammates
      for (let j = i + 1; j < players.length && potentialMatch.length < this.options.maxPartySize; j++) {
        if (usedPlayers.has(players[j].playerId)) continue;

        // Check skill compatibility
        const skillDiff = Math.abs(players[i].skill - players[j].skill);
        if (skillDiff <= this.options.skillRange) {
          potentialMatch.push(players[j]);
          usedPlayers.add(players[j].playerId);
        }
      }

      // Create match if we have enough players (at least 2 for demo)
      if (potentialMatch.length >= 2) {
        const match = this.createMatch(potentialMatch, gameMode, region, now);
        matches.push(match);
      }
    }

    return matches;
  }

  /**
   * Create a match from a group of players
   */
  createMatch(players, gameMode, region, timestamp) {
    const matchId = `match_${++this.matchCounter}`;
    const playerIds = players.map(p => p.playerId);
    const averageSkill = Math.round(players.reduce((sum, p) => sum + p.skill, 0) / players.length);

    const match = {
      id: matchId,
      players: playerIds,
      gameMode,
      region,
      averageSkill,
      playerCount: players.length,
      createdAt: timestamp,
      status: 'created'
    };

    this.matches.set(matchId, match);
    this.stats.matchesCreated++;
    this.stats.playersMatched += players.length;

    // Remove players from queue
    playerIds.forEach(playerId => {
      const player = this.queue.get(playerId);
      if (player) {
        const waitTime = timestamp - player.joinedAt;
        this.stats.totalWaitTime += waitTime;
        this.queue.delete(playerId);
      }
    });

    logger.info(`🎯 Match created: ${matchId} (${players.length} players, MMR: ${averageSkill}, Region: ${region})`);
    this.emit('matchCreated', match);

    return match;
  }

  /**
   * Remove expired players from queue
   */
  removeExpiredPlayers(now) {
    const expiredPlayers = [];

    for (const [playerId, player] of this.queue) {
      const waitTime = now - player.joinedAt;
      if (waitTime >= player.maxWaitTime) {
        expiredPlayers.push(playerId);
      }
    }

    expiredPlayers.forEach(playerId => {
      this.removeFromQueue(playerId);
    });
  }

  /**
   * Get queue status and statistics
   */
  getQueueStatus() {
    const now = Date.now();
    let totalWaitTime = 0;
    let activePlayers = 0;

    // eslint-disable-next-line no-unused-vars
    for (const [_playerId, player] of this.queue) {
      totalWaitTime += (now - player.joinedAt);
      activePlayers++;
    }

    this.stats.averageWaitTime = activePlayers > 0 ? Math.round(totalWaitTime / activePlayers) : 0;

    return {
      totalQueued: this.stats.totalQueued,
      playersWaiting: this.queue.size,
      matchesCreated: this.stats.matchesCreated,
      playersMatched: this.stats.playersMatched,
      averageWaitTime: this.stats.averageWaitTime,
      queueByRegion: this.getQueueByRegion(),
      queueByMode: this.getQueueByMode()
    };
  }

  /**
   * Get queue distribution by region
   */
  getQueueByRegion() {
    const byRegion = {};

    // eslint-disable-next-line no-unused-vars
    for (const [_playerId, player] of this.queue) {
      const region = player.preferredRegion;
      if (!byRegion[region]) {
        byRegion[region] = 0;
      }
      byRegion[region]++;
    }

    return byRegion;
  }

  /**
   * Get queue distribution by game mode
   */
  getQueueByMode() {
    const byMode = {};

    // eslint-disable-next-line no-unused-vars
    for (const [_playerId, player] of this.queue) {
      const mode = player.gameMode;
      if (!byMode[mode]) {
        byMode[mode] = 0;
      }
      byMode[mode]++;
    }

    return byMode;
  }

  /**
   * Get match details
   */
  getMatch(matchId) {
    return this.matches.get(matchId);
  }

  /**
   * Get all active matches
   */
  getActiveMatches() {
    return Array.from(this.matches.values()).filter(match => match.status === 'created');
  }
}

module.exports = MatchmakingService;