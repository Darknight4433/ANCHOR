const fs = require('fs');
const path = require('path');

/**
 * FsUtils - File system operations with GUARANTEES
 * 
 * PRINCIPLE 3: All file operations must satisfy:
 * ✅ Directory exists
 * ✅ File exists (if needed)
 * ✅ Permissions valid
 */
class FsUtils {
  /**
   * GUARANTEE A: Create directory and all parents
   * Never fails silently
   */
  static ensureDir(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
      }
      return true;
    } catch (error) {
      throw new Error(`[FsUtils] Failed to ensure directory: ${dirPath} - ${error.message}`);
    }
  }

  /**
   * GUARANTEE B: Create file if missing
   * Append mode (doesn't truncate)
   */
  static ensureFile(filePath) {
    try {
      const dir = path.dirname(filePath);
      this.ensureDir(dir);

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf8');
      }
      return true;
    } catch (error) {
      throw new Error(`[FsUtils] Failed to ensure file: ${filePath} - ${error.message}`);
    }
  }

  /**
   * GUARANTEE C: Check and fix permissions
   */
  static ensurePermissions(filePath, mode = 0o644) {
    try {
      if (fs.existsSync(filePath)) {
        fs.chmodSync(filePath, mode);
      }
      return true;
    } catch (error) {
      throw new Error(`[FsUtils] Failed to set permissions: ${filePath} - ${error.message}`);
    }
  }

  /**
   * Safe append to file
   * Returns bytes written
   */
  static safeAppend(filePath, content) {
    try {
      this.ensureFile(filePath);
      fs.appendFileSync(filePath, content, 'utf8');
      return content.length;
    } catch (error) {
      throw new Error(`[FsUtils] Failed to append to file: ${filePath} - ${error.message}`);
    }
  }

  /**
   * Safe read with validation
   */
  static safeRead(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      throw new Error(`[FsUtils] Failed to read file: ${filePath} - ${error.message}`);
    }
  }

  /**
   * Atomic write (write to temp, then rename)
   * PRINCIPLE: Never partially write
   */
  static atomicWrite(filePath, content) {
    const tempPath = filePath + '.tmp.' + Date.now();

    try {
      const dir = path.dirname(filePath);
      this.ensureDir(dir);

      // Write to temp file
      fs.writeFileSync(tempPath, content, 'utf8');

      // Atomic rename
      fs.renameSync(tempPath, filePath);
      
      return true;
    } catch (error) {
      // Clean up temp file
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw new Error(`[FsUtils] Failed atomic write: ${filePath} - ${error.message}`);
    }
  }

  /**
   * Safely delete file or directory
   */
  static safeDelete(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return true;
      }

      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }

      return true;
    } catch (error) {
      throw new Error(`[FsUtils] Failed to delete: ${filePath} - ${error.message}`);
    }
  }

  /**
   * Get file size safely
   */
  static getSize(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return 0;
      }
      return fs.statSync(filePath).size;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Rotate log file (archive old, create new)
   */
  static rotateFile(filePath, maxSize = 10 * 1024 * 1024) {
    try {
      const size = this.getSize(filePath);
      if (size < maxSize) {
        return false; // No rotation needed
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const backupPath = `${filePath}.${timestamp}.backup`;

      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, backupPath);
      }

      // Create new empty file
      fs.writeFileSync(filePath, '', 'utf8');

      return true;
    } catch (error) {
      throw new Error(`[FsUtils] Failed to rotate file: ${filePath} - ${error.message}`);
    }
  }

  /**
   * Check if path is safe (prevent directory traversal)
   */
  static isSafePath(basePath, targetPath) {
    const resolved = path.resolve(targetPath);
    const base = path.resolve(basePath);

    return resolved.startsWith(base);
  }
}

module.exports = FsUtils;
