/**
 * Validator - Input validation and sanitization for production safety
 */
class Validator {
  /**
   * Validate process name
   */
  static validateProcessName(name) {
    if (typeof name !== 'string') {
      throw new Error('Process name must be a string');
    }
    if (name.length < 1 || name.length > 255) {
      throw new Error('Process name must be between 1 and 255 characters');
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
      throw new Error('Process name can only contain alphanumeric characters, underscores, hyphens, and dots');
    }
    return true;
  }

  /**
   * Validate command
   */
  static validateCommand(command) {
    if (typeof command !== 'string') {
      throw new Error('Command must be a string');
    }
    if (command.length < 1 || command.length > 1024) {
      throw new Error('Command must be between 1 and 1024 characters');
    }
    // Prevent common injection patterns
    if (command.includes('$(') || command.includes('`') || command.includes(';')) {
      throw new Error('Command contains potentially dangerous patterns');
    }
    return true;
  }

  /**
   * Validate port number
   */
  static validatePort(port) {
    const num = parseInt(port, 10);
    if (isNaN(num) || num < 1 || num > 65535) {
      throw new Error('Port must be a number between 1 and 65535');
    }
    return true;
  }

  /**
   * Validate timeout value
   */
  static validateTimeout(timeout) {
    const num = parseInt(timeout, 10);
    if (isNaN(num) || num < 100 || num > 300000) {
      throw new Error('Timeout must be between 100ms and 300000ms');
    }
    return true;
  }

  /**
   * Validate memory limit
   */
  static validateMemoryLimit(memory) {
    if (typeof memory === 'string') {
      const match = memory.match(/^(\d+)([kmg])$/i);
      if (!match) {
        throw new Error('Memory must be in format: 512m, 1g, etc');
      }
      const num = parseInt(match[1], 10);
      if (num < 32 || num > 65536) {
        throw new Error('Memory must be between 32m and 65536m');
      }
    } else if (typeof memory === 'number') {
      if (memory < 32 || memory > 65536) {
        throw new Error('Memory must be between 32 and 65536 (MB)');
      }
    } else {
      throw new Error('Memory must be a string or number');
    }
    return true;
  }

  /**
   * Validate CPU limit
   */
  static validateCpuLimit(cpus) {
    if (typeof cpus === 'string') {
      const num = parseFloat(cpus);
      if (isNaN(num) || num < 0.1 || num > 128) {
        throw new Error('CPU must be between 0.1 and 128');
      }
    } else if (typeof cpus === 'number') {
      if (cpus < 0.1 || cpus > 128) {
        throw new Error('CPU must be between 0.1 and 128');
      }
    } else {
      throw new Error('CPU must be a string or number');
    }
    return true;
  }

  /**
   * Validate server name
   */
  static validateServerName(name) {
    return this.validateProcessName(name);
  }

  /**
   * Validate server type
   */
  static validateServerType(type) {
    if (typeof type !== 'string') {
      throw new Error('Server type must be a string');
    }
    if (!/^[a-z0-9_-]+$/.test(type)) {
      throw new Error('Server type can only contain lowercase alphanumeric characters, underscores, and hyphens');
    }
    return true;
  }

  /**
   * Validate JWT token structure
   */
  static validateJWT(token) {
    if (typeof token !== 'string') {
      throw new Error('JWT must be a string');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }
    return true;
  }

  /**
   * Validate environment variables object
   */
  static validateEnvironment(env) {
    if (typeof env !== 'object' || env === null) {
      throw new Error('Environment must be an object');
    }
    // Validate each key and value
    for (const [key, value] of Object.entries(env)) {
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        throw new Error(`Invalid environment variable name: ${key}`);
      }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`Environment variable ${key} must be a string, number, or boolean`);
      }
    }
    return true;
  }

  /**
   * Validate log level
   */
  static validateLogLevel(level) {
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLevels.includes(level)) {
      throw new Error(`Log level must be one of: ${validLevels.join(', ')}`);
    }
    return true;
  }

  /**
   * Sanitize log message
   */
  static sanitizeLogMessage(message) {
    if (typeof message !== 'string') {
      return String(message);
    }
    // Remove control characters but keep newlines
    // eslint-disable-next-line no-control-regex
    return message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  /**
   * Validate container image name
   */
  static validateImageName(image) {
    if (typeof image !== 'string') {
      throw new Error('Image name must be a string');
    }
    // Docker image name format: [REGISTRY_HOST[:REGISTRY_PORT]/]NAME[:TAG]
    if (!/^([a-z0-9-_.]+\.)*[a-z0-9-_.]+\/[a-z0-9-_.]+(:[\w.-]+)?$|^[a-z0-9-_.]+(:[\w.-]+)?$/.test(image)) {
      throw new Error('Invalid Docker image name format');
    }
    return true;
  }

  /**
   * Validate path (basic security check)
   */
  static validatePath(filePath) {
    if (typeof filePath !== 'string') {
      throw new Error('Path must be a string');
    }
    // Prevent directory traversal
    if (filePath.includes('..')) {
      throw new Error('Path cannot contain directory traversal sequences');
    }
    return true;
  }

  /**
   * Validate webhook URL
   */
  static validateWebhookUrl(url) {
    if (typeof url !== 'string') {
      throw new Error('Webhook URL must be a string');
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Webhook URL must use HTTP or HTTPS');
      }
    } catch (error) {
      throw new Error('Invalid webhook URL format');
    }
    return true;
  }

  /**
   * Validate restart policy
   */
  static validateRestartPolicy(policy) {
    const validPolicies = ['no', 'always', 'on-failure', 'unless-stopped'];
    if (!validPolicies.includes(policy)) {
      throw new Error(`Restart policy must be one of: ${validPolicies.join(', ')}`);
    }
    return true;
  }
}

module.exports = Validator;
