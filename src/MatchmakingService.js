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
      aiOptimizationEnabled: options.aiOptimizationEnabled || true,
      dynamicSkillAdjustment: options.dynamicSkillAdjustment || true,
      ...options
    };

    this.queue = new Map(); // playerId -> player data
    this.matches = new Map(); // matchId -> match data
    this.interval = null;
    this.matchCounter = 0;

    // AI learning data
    this.playerHistory = new Map(); // playerId -> match history
    this.matchOutcomes = new Map(); // matchId -> outcome data
    this.skillAdjustments = new Map(); // playerId -> skill change history

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
   * Record match outcome for AI learning
   */
  recordMatchOutcome(matchId, outcome) {
    const match = this.matches.get(matchId);
    if (!match) return;

    const outcomeData = {
      matchId,
      players: match.players,
      averageSkill: match.averageSkill,
      gameMode: match.gameMode,
      region: match.region,
      duration: outcome.duration || 0,
      winner: outcome.winner,
      scores: outcome.scores || {},
      timestamp: Date.now(),
      ...outcome
    };

    this.matchOutcomes.set(matchId, outcomeData);

    // Update player history
    match.players.forEach(playerId => {
      if (!this.playerHistory.has(playerId)) {
        this.playerHistory.set(playerId, []);
      }
      this.playerHistory.get(playerId).push(outcomeData);

      // Keep only last 20 matches per player
      if (this.playerHistory.get(playerId).length > 20) {
        this.playerHistory.get(playerId).shift();
      }
    });

    // AI: Adjust skill ratings based on outcome
    if (this.options.dynamicSkillAdjustment) {
      this.adjustPlayerSkills(match, outcome);
    }

    logger.info(`📊 Match ${matchId} outcome recorded: ${outcome.winner || 'completed'}`);
  }

  /**
   * AI: Adjust player skills based on match outcomes
   */
  adjustPlayerSkills(match, outcome) {
    if (!outcome.scores || Object.keys(outcome.scores).length === 0) return;

    const players = match.players;
    const scores = outcome.scores;

    // Simple ELO-like adjustment
    const kFactor = 32; // Adjustment factor

    players.forEach(playerId => {
      const playerScore = scores[playerId] || 0;
      const avgOpponentScore = players
        .filter(p => p !== playerId)
        .reduce((sum, p) => sum + (scores[p] || 0), 0) / (players.length - 1);

      const expectedScore = 1 / (1 + Math.pow(10, (avgOpponentScore - playerScore) / 400));
      const actualScore = playerScore > avgOpponentScore ? 1 : 0; // Simplified win/loss

      const skillChange = kFactor * (actualScore - expectedScore);

      // Record adjustment
      if (!this.skillAdjustments.has(playerId)) {
        this.skillAdjustments.set(playerId, []);
      }
      this.skillAdjustments.get(playerId).push({
        matchId: match.id,
        oldSkill: this.getPlayerSkill(playerId),
        skillChange,
        timestamp: Date.now()
      });

      // Update player's skill (this would normally be persisted)
      // For demo, we'll adjust the queued player's skill if they're still in queue
      const queuedPlayer = this.queue.get(playerId);
      if (queuedPlayer) {
        queuedPlayer.skill = Math.max(0, queuedPlayer.skill + skillChange);
      }
    });
  }

  /**
   * Get player's current skill rating
   */
  getPlayerSkill(playerId) {
    const queuedPlayer = this.queue.get(playerId);
    if (queuedPlayer) return queuedPlayer.skill;

    // Look in history
    const history = this.playerHistory.get(playerId);
    if (history && history.length > 0) {
      const lastMatch = history[history.length - 1];
      return lastMatch.averageSkill || 1000; // Fallback
    }

    return 1000; // Default
  }

  /**
   * AI: Learn player behavior patterns
   */
  learnPlayerBehavior(playerId) {
    const history = this.playerHistory.get(playerId);
    if (!history || history.length < 3) return null;

    // Analyze preferred game modes, regions, play times
    const gameModes = history.map(m => m.gameMode);
    const regions = history.map(m => m.region);
    const durations = history.map(m => m.duration || 0);

    const preferredMode = this.getMostFrequent(gameModes);
    const preferredRegion = this.getMostFrequent(regions);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

    return {
      playerId,
      preferredGameMode: preferredMode,
      preferredRegion,
      averageMatchDuration: Math.round(avgDuration),
      totalMatches: history.length,
      winRate: this.calculateWinRate(history, playerId)
    };
  }

  /**
   * Helper: Get most frequent item in array
   */
  getMostFrequent(arr) {
    const freq = {};
    arr.forEach(item => {
      freq[item] = (freq[item] || 0) + 1;
    });
    return Object.keys(freq).reduce((a, b) => freq[a] > freq[b] ? a : b);
  }

  /**
   * Helper: Calculate win rate for player
   */
  calculateWinRate(history, playerId) {
    let wins = 0;
    history.forEach(match => {
      if (match.winner && match.scores) {
        const playerScore = match.scores[playerId] || 0;
        const maxScore = Math.max(...Object.values(match.scores));
        if (playerScore === maxScore) wins++;
      }
    });
    return history.length > 0 ? wins / history.length : 0;
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

    // AI Optimization: Sort by compatibility score instead of just skill
    if (this.options.aiOptimizationEnabled) {
      players = this.sortPlayersByCompatibility(players, gameMode, region);
    } else {
      players.sort((a, b) => a.skill - b.skill);
    }

    for (let i = 0; i < players.length; i++) {
      if (usedPlayers.has(players[i].playerId)) continue;

      const potentialMatch = [players[i]];
      usedPlayers.add(players[i].playerId);

      // Try to find suitable teammates with AI optimization
      for (let j = i + 1; j < players.length && potentialMatch.length < this.options.maxPartySize; j++) {
        if (usedPlayers.has(players[j].playerId)) continue;

        let compatible = false;

        if (this.options.aiOptimizationEnabled) {
          // AI: Use compatibility scoring
          const compatibility = this.calculateCompatibility(potentialMatch[0], players[j], gameMode, region);
          compatible = compatibility.score > 0.6; // Threshold for compatibility
        } else {
          // Original skill-based matching
          const skillDiff = Math.abs(potentialMatch[0].skill - players[j].skill);
          compatible = skillDiff <= this.options.skillRange;
        }

        if (compatible) {
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
   * AI: Sort players by overall compatibility for better matching
   */
  sortPlayersByCompatibility(players, gameMode, region) {
    return players.map(player => ({
      ...player,
      compatibilityScore: this.calculatePlayerCompatibilityScore(player, gameMode, region)
    })).sort((a, b) => b.compatibilityScore - a.compatibilityScore);
  }

  /**
   * AI: Calculate compatibility score for a player
   */
  calculatePlayerCompatibilityScore(player, gameMode, region) {
    let score = 0.5; // Base score

    // Prefer players with learned preferences
    const behavior = this.learnPlayerBehavior(player.playerId);
    if (behavior) {
      if (behavior.preferredGameMode === gameMode) score += 0.2;
      if (behavior.preferredRegion === region) score += 0.2;
      score += behavior.winRate * 0.1; // Higher win rate = better compatibility
    }

    // Prefer players with more match history (more data for better matching)
    const history = this.playerHistory.get(player.playerId);
    if (history) {
      score += Math.min(history.length / 20, 0.2); // Max 0.2 for 20+ matches
    }

    return Math.min(1.0, score);
  }

  /**
   * AI: Calculate compatibility between two players
   */
  // eslint-disable-next-line no-unused-vars
  calculateCompatibility(player1, player2, gameMode, region) {
    let score = 0;
    let reasons = [];

    // Skill difference (core factor)
    const skillDiff = Math.abs(player1.skill - player2.skill);
    const skillScore = Math.max(0, 1 - (skillDiff / this.options.skillRange));
    score += skillScore * 0.4;
    reasons.push(`skill_diff: ${skillDiff}`);

    // Behavior compatibility
    const behavior1 = this.learnPlayerBehavior(player1.playerId);
    const behavior2 = this.learnPlayerBehavior(player2.playerId);

    if (behavior1 && behavior2) {
      // Similar win rates (balanced teams)
      const winRateDiff = Math.abs(behavior1.winRate - behavior2.winRate);
      const winRateScore = Math.max(0, 1 - winRateDiff);
      score += winRateScore * 0.2;
      reasons.push(`win_rate_diff: ${winRateDiff.toFixed(2)}`);

      // Similar preferred regions
      if (behavior1.preferredRegion === behavior2.preferredRegion) {
        score += 0.2;
        reasons.push('same_region_pref');
      }

      // Similar game mode preferences
      if (behavior1.preferredGameMode === behavior2.preferredGameMode) {
        score += 0.2;
        reasons.push('same_mode_pref');
      }
    }

    // Wait time bonus (don't keep players waiting too long)
    const now = Date.now();
    const wait1 = now - player1.joinedAt;
    const wait2 = now - player2.joinedAt;
    const avgWait = (wait1 + wait2) / 2;
    const waitBonus = Math.min(avgWait / 60000, 1) * 0.1; // Max 0.1 for 1+ minute wait
    score += waitBonus;
    reasons.push(`avg_wait: ${(avgWait/1000).toFixed(1)}s`);

    return {
      score: Math.min(1.0, score),
      reasons,
      players: [player1.playerId, player2.playerId]
    };
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
      queueByMode: this.getQueueByMode(),
      aiStats: {
        aiOptimizationEnabled: this.options.aiOptimizationEnabled,
        playersWithHistory: this.playerHistory.size,
        totalMatchOutcomes: this.matchOutcomes.size,
        skillAdjustments: Array.from(this.skillAdjustments.values()).reduce((sum, arr) => sum + arr.length, 0)
      }
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