const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const logger = require('./Logger.js');

/**
 * PluginSecurityScanner - Scans plugins for security vulnerabilities
 * Detects dangerous code patterns, suspicious requires, and security issues
 */
class PluginSecurityScanner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      scanBeforeLoad: options.scanBeforeLoad || true,
      blockSuspicious: options.blockSuspicious || true,
      allowedRequires: options.allowedRequires || [
        'events', 'util', 'path', 'fs', 'crypto', 'os', 'dns',
        'express', 'winston', 'joi', 'helmet', 'dotenv'
      ],
      dangerousPatterns: options.dangerousPatterns || {
        eval: /\beval\s*\(/gi,
        dynamicRequire: /require\s*\(\s*['"`][\w\s_*./+-]+['"`]/gi,
        childProcess: /require\s*\(\s*['"`](child_process|spawn|exec)['"`]/gi,
        netModule: /require\s*\(\s*['"`](net|dgram)['"`]/gi,
        fsDelete: /fs\.(rm|unlink|rmdir)/gi,
        globalAccess: /global\./gi
      },
      ...options
    };

    this.scanResults = new Map(); // pluginId -> scan result
    this.trustedPlugins = new Set();
    this.blockedPlugins = new Set();
  }

  /**
   * Scan plugin code for security issues
   */
  scanPluginCode(pluginId, pluginCode) {
    const scanResult = {
      pluginId,
      timestamp: Date.now(),
      passed: true,
      issues: [],
      warnings: [],
      riskScore: 0,
      scanDuration: 0
    };

    const startTime = Date.now();

    try {
      // Check for dangerous patterns
      this.detectDangerousPatterns(pluginCode, scanResult);

      // Check for suspicious requires
      this.detectSuspiciousRequires(pluginCode, scanResult);

      // Check code complexity
      this.analyzeCComplexity(pluginCode, scanResult);

      // Calculate risk score
      scanResult.riskScore = scanResult.issues.length * 10 + scanResult.warnings.length * 2;

      // Determine if scan passed
      if (scanResult.issues.length > 0 && this.options.blockSuspicious) {
        scanResult.passed = false;
      }

      scanResult.scanDuration = Date.now() - startTime;

      this.scanResults.set(pluginId, scanResult);

      logger.info(`🔍 Plugin scan: ${pluginId} - Risk: ${scanResult.riskScore}%, Issues: ${scanResult.issues.length}`);
      this.emit('pluginScanned', scanResult);

      return scanResult;
    } catch (error) {
      logger.error(`Plugin scan error for ${pluginId}: ${error.message}`);
      scanResult.passed = false;
      scanResult.issues.push(`Scan error: ${error.message}`);
      return scanResult;
    }
  }

  /**
   * Scan plugin file for security issues
   */
  scanPluginFile(pluginPath) {
    try {
      const pluginCode = fs.readFileSync(pluginPath, 'utf8');
      const pluginId = path.basename(pluginPath);

      return this.scanPluginCode(pluginId, pluginCode);
    } catch (error) {
      logger.error(`Failed to read plugin file ${pluginPath}: ${error.message}`);
      return {
        pluginId: path.basename(pluginPath),
        passed: false,
        issues: [`Failed to read plugin: ${error.message}`]
      };
    }
  }

  /**
   * Detect dangerous code patterns
   */
  detectDangerousPatterns(code, scanResult) {
    for (const [patternName, pattern] of Object.entries(this.options.dangerousPatterns)) {
      const matches = code.match(pattern);
      if (matches) {
        scanResult.issues.push(`❌ Dangerous pattern detected: ${patternName} (${matches.length} occurrence${matches.length > 1 ? 's' : ''})`);
        logger.warn(`Dangerous pattern in plugin: ${patternName}`);
      }
    }
  }

  /**
   * Detect suspicious require statements
   */
  detectSuspiciousRequires(code, scanResult) {
    // Extract all require statements
    const requirePattern = /require\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let match;

    const requires = new Set();
    while ((match = requirePattern.exec(code)) !== null) {
      requires.add(match[1]);
    }

    // Check against allowed requires
    for (const req of requires) {
      // Check if it's a built-in or allowed module
      const moduleName = req.split('/')[0];

      if (!this.options.allowedRequires.includes(moduleName)) {
        // Allow scoped packages (@scope/package)
        if (!moduleName.startsWith('@')) {
          scanResult.warnings.push(`⚠️ Uncommon require detected: ${req}`);
        }
      }
    }
  }

  /**
   * Analyze code complexity
   */
  analyzeCComplexity(code, scanResult) {
    // Count functions
    const functionCount = (code.match(/function\s+\w+|const\s+\w+ = (?:\(.*?\)|.*?) =>/g) || []).length;

    // Check for nested callbacks (callback hell)
    const nestedCallbacks = (code.match(/\.then\s*\(\|\.catch\s*\(/g) || []).length;

    if (functionCount > 50) {
      scanResult.warnings.push(`⚠️ High function count: ${functionCount} functions`);
    }

    if (nestedCallbacks > 5) {
      scanResult.warnings.push(`⚠️ High callback nesting detected`);
    }

    // Check code size
    const lines = code.split('\n').length;
    if (lines > 1000) {
      scanResult.warnings.push(`⚠️ Large plugin: ${lines} lines of code`);
    }
  }

  /**
   * Check if plugin is allowed to load
   */
  canLoadPlugin(pluginId) {
    if (this.trustedPlugins.has(pluginId)) {
      return true;
    }

    if (this.blockedPlugins.has(pluginId)) {
      return false;
    }

    const scanResult = this.scanResults.get(pluginId);
    if (!scanResult) {
      return true; // Allow if not scanned yet
    }

    return scanResult.passed;
  }

  /**
   * Trust a plugin (skip security checks)
   */
  trustPlugin(pluginId) {
    this.trustedPlugins.add(pluginId);
    this.blockedPlugins.delete(pluginId);
    logger.info(`✅ Plugin trusted: ${pluginId}`);
    this.emit('pluginTrusted', { pluginId });
  }

  /**
   * Block a plugin
   */
  blockPlugin(pluginId, reason = 'Security concern') {
    this.blockedPlugins.add(pluginId);
    this.trustedPlugins.delete(pluginId);
    logger.warn(`🚫 Plugin blocked: ${pluginId} - ${reason}`);
    this.emit('pluginBlocked', { pluginId, reason });
  }

  /**
   * Get scan history for plugin
   */
  getScanHistory(pluginId, limit = 10) {
    const history = [];
    const scanResult = this.scanResults.get(pluginId);

    if (scanResult) {
      history.push(scanResult);
    }

    return history.slice(0, limit);
  }

  /**
   * Get security dashboard stats
   */
  getDashboardStats() {
    const allScans = Array.from(this.scanResults.values());
    const passedScans = allScans.filter(s => s.passed);
    const failedScans = allScans.filter(s => !s.passed);
    const totalIssues = allScans.reduce((sum, s) => sum + s.issues.length, 0);
    const totalWarnings = allScans.reduce((sum, s) => sum + s.warnings.length, 0);
    const avgRiskScore = allScans.length > 0 ? allScans.reduce((sum, s) => sum + s.riskScore, 0) / allScans.length : 0;

    return {
      totalPluginsScanned: allScans.length,
      passedScans: passedScans.length,
      failedScans: failedScans.length,
      passPercentage: allScans.length > 0 ? Math.round((passedScans.length / allScans.length) * 100) : 0,
      totalIssuesFound: totalIssues,
      totalWarnings: totalWarnings,
      averageRiskScore: Math.round(avgRiskScore),
      trustedPlugins: this.trustedPlugins.size,
      blockedPlugins: this.blockedPlugins.size,
      highRiskPlugins: allScans.filter(s => s.riskScore > 50).length
    };
  }

  /**
   * Generate security report for plugin
   */
  generateSecurityReport(pluginId) {
    const scanResult = this.scanResults.get(pluginId);

    if (!scanResult) {
      return {
        pluginId,
        status: 'NOT_SCANNED'
      };
    }

    return {
      pluginId,
      status: scanResult.passed ? 'PASSED' : 'FAILED',
      timestamp: new Date(scanResult.timestamp).toISOString(),
      scanDuration: `${scanResult.scanDuration}ms`,
      riskScore: `${scanResult.riskScore}%`,
      issues: scanResult.issues,
      warnings: scanResult.warnings,
      trustLevel: this.getTrustLevel(scanResult.riskScore),
      recommendation: this.getRecommendation(scanResult)
    };
  }

  /**
   * Get trust level based on risk score
   */
  getTrustLevel(riskScore) {
    if (riskScore === 0) return 'TRUSTED';
    if (riskScore < 20) return 'SAFE';
    if (riskScore < 50) return 'CAUTION';
    if (riskScore < 80) return 'RISKY';
    return 'DANGEROUS';
  }

  /**
   * Get recommendation based on scan result
   */
  getRecommendation(scanResult) {
    if (scanResult.issues.length > 0) {
      return `⛔ Do not load - ${scanResult.issues.length} critical issue${scanResult.issues.length > 1 ? 's' : ''}`;
    }

    if (scanResult.warnings.length > 1) {
      return `⚠️ Review carefully before loading`;
    }

    if (scanResult.warnings.length === 1) {
      return `ℹ️ Can load with caution`;
    }

    return `✅ Safe to load`;
  }

  /**
   * Scan all plugins in directory
   */
  scanPluginDirectory(pluginDir) {
    const results = {
      total: 0,
      passed: 0,
      failed: 0,
      scans: []
    };

    try {
      if (!fs.existsSync(pluginDir)) {
        return results;
      }

      const plugins = fs.readdirSync(pluginDir);

      for (const plugin of plugins) {
        const pluginPath = path.join(pluginDir, plugin);
        const stat = fs.statSync(pluginPath);

        if (stat.isFile() && plugin.endsWith('.js')) {
          const scanResult = this.scanPluginFile(pluginPath);
          results.total++;

          if (scanResult.passed) {
            results.passed++;
          } else {
            results.failed++;
          }

          results.scans.push(scanResult);
        }
      }

      logger.info(`🔍 Directory scan complete: ${results.total} plugins, ${results.passed} passed, ${results.failed} failed`);
    } catch (error) {
      logger.error(`Error scanning plugin directory: ${error.message}`);
    }

    return results;
  }

  /**
   * Add allowed require module
   */
  addAllowedRequire(moduleName) {
    if (!this.options.allowedRequires.includes(moduleName)) {
      this.options.allowedRequires.push(moduleName);
      logger.info(`✅ Added allowed require: ${moduleName}`);
    }
  }

  /**
   * Remove allowed require module
   */
  removeAllowedRequire(moduleName) {
    const index = this.options.allowedRequires.indexOf(moduleName);
    if (index > -1) {
      this.options.allowedRequires.splice(index, 1);
      logger.info(`❌ Removed allowed require: ${moduleName}`);
    }
  }

  /**
   * Add dangerous pattern
   */
  addDangerousPattern(patternName, regexPattern) {
    this.options.dangerousPatterns[patternName] = regexPattern;
    logger.info(`✅ Added dangerous pattern: ${patternName}`);
  }
}

module.exports = PluginSecurityScanner;
