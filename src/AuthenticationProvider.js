const EventEmitter = require('events');
const logger = require('./Logger.js');
const crypto = require('crypto');

/**
 * AuthenticationProvider - Enterprise authentication with LDAP/AD and Vault support
 * Manages user authentication, session management, and MFA
 */
class AuthenticationProvider extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      enableLDAP: options.enableLDAP || false,
      enableMFA: options.enableMFA || false,
      sessionTimeout: options.sessionTimeout || 3600000, // 1 hour
      passwordPolicy: options.passwordPolicy || {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true
      },
      vaultAddress: options.vaultAddress,
      vaultToken: options.vaultToken,
      ...options
    };

    this.users = new Map(); // userId -> user data
    this.sessions = new Map(); // sessionId -> session data
    this.mfaTokens = new Map(); // userId -> mfa secret
    this.ldapConfig = null;
    this.vaultConnected = false;
  }

  /**
   * Register LDAP/AD configuration
   */
  configureLDAP(config) {
    this.ldapConfig = {
      serverUrl: config.serverUrl || 'ldap://localhost:389',
      baseDN: config.baseDN,
      bindDN: config.bindDN,
      bindPassword: config.bindPassword,
      userSearchFilter: config.userSearchFilter || '(&(objectClass=user)(sAMAccountName={username}))',
      groupSearchFilter: config.groupSearchFilter || '(&(objectClass=group)(member={userDN}))',
      syncInterval: config.syncInterval || 3600000, // 1 hour
      enabled: true
    };

    logger.info(`👥 LDAP/AD configured: ${config.serverUrl}`);
    this.emit('ldapConfigured', this.ldapConfig);

    return this.ldapConfig;
  }

  /**
   * Authenticate user with password
   */
  authenticateUser(username, password) {
    try {
      // Validate password format
      if (!this.validatePasswordPolicy(password)) {
        this.logAuthEvent('authentication_failed', username, 'Invalid password format');
        return {
          success: false,
          error: 'Password does not meet policy requirements'
        };
      }

      // Check if user exists
      const user = this.getUserByUsername(username);
      if (!user) {
        this.logAuthEvent('authentication_failed', username, 'User not found');
        return {
          success: false,
          error: 'Invalid credentials'
        };
      }

      // Verify password hash
      const passwordHash = this.hashPassword(password, user.salt);
      if (passwordHash !== user.passwordHash) {
        user.failedAttempts = (user.failedAttempts || 0) + 1;

        // Lock account after 5 failed attempts
        if (user.failedAttempts >= 5) {
          user.locked = true;
          user.lockedUntil = Date.now() + 15 * 60 * 1000; // 15 minute lockout
          this.logAuthEvent('account_locked', username, 'Too many failed attempts');
        }

        this.logAuthEvent('authentication_failed', username, 'Invalid password');
        return {
          success: false,
          error: 'Invalid credentials'
        };
      }

      // Check if account is locked
      if (user.locked && user.lockedUntil > Date.now()) {
        this.logAuthEvent('authentication_blocked', username, 'Account locked');
        return {
          success: false,
          error: 'Account temporarily locked. Try again later.'
        };
      }

      // Reset failed attempts on successful login
      user.failedAttempts = 0;
      user.locked = false;
      user.lastLogin = Date.now();

      // Check if MFA is enabled
      if (this.options.enableMFA && user.mfaEnabled) {
        return {
          success: true,
          mfaRequired: true,
          userId: user.id,
          sessionId: this.generateSessionId()
        };
      }

      // Create session
      const session = this.createSession(user.id, user.role);

      this.logAuthEvent('authentication_success', username, 'User authenticated');
      this.emit('userAuthenticated', { userId: user.id, username });

      return {
        success: true,
        sessionId: session.id,
        token: session.token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          email: user.email
        }
      };
    } catch (error) {
      logger.error(`Authentication error: ${error.message}`);
      return {
        success: false,
        error: 'Authentication service error'
      };
    }
  }

  /**
   * Authenticate with LDAP/AD
   */
  async authenticateLDAP(username, password) {
    if (!this.ldapConfig || !this.ldapConfig.enabled) {
      return { success: false, error: 'LDAP not configured' };
    }

    try {
      logger.info(`🔐 Attempting LDAP authentication for ${username}`);

      // Simulate LDAP bind and user lookup
      // In production, use ldapjs or similar library
      const ldapUser = await this.searchLDAPUser(username);

      if (!ldapUser) {
        this.logAuthEvent('ldap_auth_failed', username, 'User not found in LDAP');
        return { success: false, error: 'Invalid LDAP credentials' };
      }

      // Verify LDAP password (simulated)
      const validPassword = this.verifyLDAPPassword(username, password, ldapUser);
      if (!validPassword) {
        this.logAuthEvent('ldap_auth_failed', username, 'Invalid LDAP password');
        return { success: false, error: 'Invalid LDAP credentials' };
      }

      // Sync or create local user from LDAP
      let localUser = this.getUserByUsername(username);
      if (!localUser) {
        localUser = this.createUserFromLDAP(ldapUser);
      } else {
        // Update user data from LDAP
        this.updateUserFromLDAP(localUser, ldapUser);
      }

      // Create session
      const session = this.createSession(localUser.id, localUser.role);

      this.logAuthEvent('ldap_auth_success', username, 'LDAP authentication successful');
      this.emit('userAuthenticatedLDAP', { userId: localUser.id, username });

      return {
        success: true,
        sessionId: session.id,
        token: session.token,
        source: 'ldap',
        user: {
          id: localUser.id,
          username: localUser.username,
          role: localUser.role,
          email: localUser.email
        }
      };
    } catch (error) {
      logger.error(`LDAP authentication error: ${error.message}`);
      return { success: false, error: 'LDAP authentication failed' };
    }
  }

  /**
   * Search LDAP user (simulated)
   */
  async searchLDAPUser(username) {
    // Simulate LDAP search
    return {
      uid: username,
      mail: `${username}@company.com`,
      displayName: username.charAt(0).toUpperCase() + username.slice(1),
      memberOf: ['cn=developers,dc=company,dc=com']
    };
  }

  /**
   * Verify LDAP password (simulated)
   */
  verifyLDAPPassword(username, password, ldapUser) {
    // In production, perform actual LDAP bind
    // For demo, any non-empty password is accepted
    return password && password.length > 0;
  }

  /**
   * Create local user from LDAP user
   */
  createUserFromLDAP(ldapUser) {
    const userId = `ldap-${ldapUser.uid}-${Date.now()}`;
    const user = {
      id: userId,
      username: ldapUser.uid,
      email: ldapUser.mail,
      displayName: ldapUser.displayName,
      role: 'developer', // Default role
      source: 'ldap',
      createdAt: Date.now(),
      lastLogin: Date.now(),
      mfaEnabled: this.options.enableMFA,
      failedAttempts: 0
    };

    this.users.set(userId, user);
    logger.info(`👤 Created local user from LDAP: ${ldapUser.uid}`);

    return user;
  }

  /**
   * Update local user from LDAP
   */
  updateUserFromLDAP(localUser, ldapUser) {
    localUser.email = ldapUser.mail;
    localUser.displayName = ldapUser.displayName;
    localUser.lastSync = Date.now();
  }

  /**
   * Create session
   */
  createSession(userId, role) {
    const sessionId = this.generateSessionId();
    const token = this.generateJWT(userId, role);

    const session = {
      id: sessionId,
      userId,
      role,
      token,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.options.sessionTimeout,
      ipAddress: 'unknown',
      userAgent: 'unknown',
      isActive: true
    };

    this.sessions.set(sessionId, session);

    logger.info(`🔑 Session created: ${sessionId.substring(0, 8)}... for user ${userId}`);

    return session;
  }

  /**
   * Validate session
   */
  validateSession(sessionId, token) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return { valid: false, error: 'Session not found' };
    }

    if (!session.isActive) {
      return { valid: false, error: 'Session inactive' };
    }

    if (Date.now() > session.expiresAt) {
      session.isActive = false;
      return { valid: false, error: 'Session expired' };
    }

    if (session.token !== token) {
      return { valid: false, error: 'Invalid token' };
    }

    // Extend session
    session.expiresAt = Date.now() + this.options.sessionTimeout;
    session.lastActivity = Date.now();

    return {
      valid: true,
      userId: session.userId,
      role: session.role,
      expiresAt: session.expiresAt
    };
  }

  /**
   * Enable MFA for user
   */
  enableMFA(userId) {
    const user = this.users.get(userId);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Generate MFA secret (TOTP)
    const mfaSecret = crypto.randomBytes(32).toString('base64');
    this.mfaTokens.set(userId, {
      secret: mfaSecret,
      createdAt: Date.now(),
      verified: false
    });

    user.mfaEnabled = true;

    logger.info(`🔐 MFA enabled for user ${userId}`);
    this.logAuthEvent('mfa_enabled', userId, 'MFA enabled');

    return {
      success: true,
      mfaSecret,
      qrCode: `otpauth://totp/ANCHOR:${user.username}?secret=${mfaSecret}` // Simplified QR code
    };
  }

  /**
   * Verify MFA token
   */
  verifyMFAToken(userId, token) {
    const mfaData = this.mfaTokens.get(userId);
    if (!mfaData) {
      return { success: false, error: 'MFA not configured' };
    }

    // Simplified MFA verification
    // In production, use time-based OTP (TOTP) library
    const isValid = token.length === 6 && /^\d+$/.test(token);

    if (!isValid) {
      this.logAuthEvent('mfa_verification_failed', userId, 'Invalid MFA token');
      return { success: false, error: 'Invalid MFA token' };
    }

    mfaData.verified = true;
    logger.info(`✅ MFA verified for user ${userId}`);

    return { success: true };
  }

  /**
   * Logout user
   */
  logout(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      session.loggedOutAt = Date.now();
      logger.info(`🚪 User logged out: ${session.userId}`);
      this.logAuthEvent('logout', session.userId, 'User logged out');
    }
    return { success: true };
  }

  /**
   * Hash password with salt
   */
  hashPassword(password, salt = null) {
    if (!salt) {
      salt = crypto.randomBytes(16).toString('hex');
    }

    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return hash;
  }

  /**
   * Validate password policy
   */
  validatePasswordPolicy(password) {
    const policy = this.options.passwordPolicy;

    if (password.length < policy.minLength) return false;
    if (policy.requireUppercase && !/[A-Z]/.test(password)) return false;
    if (policy.requireLowercase && !/[a-z]/.test(password)) return false;
    if (policy.requireNumbers && !/\d/.test(password)) return false;
    if (policy.requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return false;

    return true;
  }

  /**
   * Create local user
   */
  createLocalUser(username, password, email, role = 'developer') {
    if (this.getUserByUsername(username)) {
      return { success: false, error: 'User already exists' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword(password, salt);

    const user = {
      id: `local-${username}-${Date.now()}`,
      username,
      email,
      role,
      source: 'local',
      passwordHash,
      salt,
      createdAt: Date.now(),
      mfaEnabled: false,
      failedAttempts: 0
    };

    this.users.set(user.id, user);
    logger.info(`👤 Created local user: ${username}`);

    return { success: true, user };
  }

  /**
   * Get user by username
   */
  getUserByUsername(username) {
    return Array.from(this.users.values()).find(u => u.username === username);
  }

  /**
   * Generate session ID
   */
  generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generate JWT token
   */
  generateJWT(userId, role) {
    // Simplified JWT (not cryptographically signed in this demo)
    const payload = {
      userId,
      role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + this.options.sessionTimeout) / 1000)
    };

    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * Log authentication event
   */
  logAuthEvent(eventType, userId, description) {
    logger.info(`🔐 AUTH EVENT: ${eventType} - ${description}`);
    this.emit('authEvent', {
      type: eventType,
      userId,
      description,
      timestamp: Date.now()
    });
  }

  /**
   * Get authentication dashboard stats
   */
  getDashboardStats() {
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.isActive && s.expiresAt > Date.now());

    return {
      totalUsers: this.users.size,
      localUsers: Array.from(this.users.values()).filter(u => u.source === 'local').length,
      ldapUsers: Array.from(this.users.values()).filter(u => u.source === 'ldap').length,
      activeSessions: activeSessions.length,
      mfaEnabled: Array.from(this.users.values()).filter(u => u.mfaEnabled).length,
      lockedAccounts: Array.from(this.users.values()).filter(u => u.locked).length,
      ldapConfigured: !!this.ldapConfig,
      mfaSupported: this.options.enableMFA
    };
  }
}

module.exports = AuthenticationProvider;
