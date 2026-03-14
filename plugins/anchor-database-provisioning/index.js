const Plugin = require('../../src/Plugin.js');
const Docker = require('dockerode');

/**
 * Database Provisioning Plugin for ANCHOR
 * Auto-provisions PostgreSQL, Redis, and MongoDB databases
 */
class DatabaseProvisioningPlugin extends Plugin {
  constructor(options) {
    super(options);
    this.name = 'anchor-database-provisioning';
    this.version = '1.0.0';
    this.description = 'Auto-provision PostgreSQL, Redis, and MongoDB databases';

    // Events this plugin listens to
    this.events = ['appDeployed', 'serviceDeployed'];

    // Docker client
    this.docker = null;

    // Database instances
    this.databases = new Map();
  }

  async init(api) {
    await super.init(api);

    // Initialize Docker client
    this.docker = new Docker();

    this.api.info('Database Provisioning Plugin initialized');
  }

  async onEvent(event, data) {
    try {
      switch (event) {
        case 'appDeployed':
          await this.handleAppDeployment(data);
          break;
        case 'serviceDeployed':
          await this.handleServiceDeployment(data);
          break;
      }
    } catch (error) {
      this.api.error(`Database Provisioning Plugin error:`, error);
    }
  }

  async handleAppDeployment(data) {
    const { name, env } = data;

    // Check if app needs database
    if (this.needsDatabase(env)) {
      const dbType = this.detectDatabaseType(env);
      await this.provisionDatabase(name, dbType);
    }
  }

  async handleServiceDeployment(data) {
    const { name, env } = data;

    // Services often need databases
    if (this.needsDatabase(env)) {
      const dbType = this.detectDatabaseType(env);
      await this.provisionDatabase(name, dbType);
    }
  }

  needsDatabase(env) {
    // Check for database-related environment variables
    const dbVars = ['DATABASE_URL', 'DB_HOST', 'POSTGRES_', 'REDIS_', 'MONGO'];
    return Object.keys(env || {}).some(key =>
      dbVars.some(dbVar => key.includes(dbVar))
    );
  }

  detectDatabaseType(env) {
    const envStr = JSON.stringify(env).toLowerCase();

    if (envStr.includes('postgres')) return 'postgresql';
    if (envStr.includes('redis')) return 'redis';
    if (envStr.includes('mongo')) return 'mongodb';

    // Default to PostgreSQL
    return 'postgresql';
  }

  async provisionDatabase(appName, dbType) {
    try {
      const dbName = `${appName}-db`;
      const existingDb = this.databases.get(dbName);

      if (existingDb) {
        this.api.info(`Database ${dbName} already exists`);
        return existingDb;
      }

      this.api.info(`Provisioning ${dbType} database for ${appName}`);

      const dbConfig = this.getDatabaseConfig(dbType, dbName);
      const container = await this.docker.createContainer(dbConfig);

      await container.start();

      const dbInfo = {
        id: container.id,
        name: dbName,
        type: dbType,
        appName,
        connectionString: this.getConnectionString(dbType, dbName),
        createdAt: new Date().toISOString()
      };

      this.databases.set(dbName, dbInfo);

      this.api.info(`Database ${dbName} provisioned successfully`);
      return dbInfo;
    } catch (error) {
      this.api.error(`Failed to provision database for ${appName}:`, error);
      throw error;
    }
  }

  getDatabaseConfig(dbType, dbName) {
    const configs = {
      postgresql: {
        Image: 'postgres:15-alpine',
        name: dbName,
        Env: [
          'POSTGRES_DB=app',
          'POSTGRES_USER=app',
          'POSTGRES_PASSWORD=password'
        ],
        HostConfig: {
          PortBindings: {
            '5432/tcp': [{ HostPort: '0' }] // Auto-assign port
          }
        }
      },
      redis: {
        Image: 'redis:7-alpine',
        name: dbName,
        HostConfig: {
          PortBindings: {
            '6379/tcp': [{ HostPort: '0' }]
          }
        }
      },
      mongodb: {
        Image: 'mongo:7-jammy',
        name: dbName,
        Env: [
          'MONGO_INITDB_ROOT_USERNAME=admin',
          'MONGO_INITDB_ROOT_PASSWORD=password'
        ],
        HostConfig: {
          PortBindings: {
            '27017/tcp': [{ HostPort: '0' }]
          }
        }
      }
    };

    return configs[dbType] || configs.postgresql;
  }

  getConnectionString(dbType, dbName) {
    const baseUrl = 'localhost'; // In production, this would be the actual host

    switch (dbType) {
      case 'postgresql':
        return `postgresql://app:password@${baseUrl}:5432/app`;
      case 'redis':
        return `redis://${baseUrl}:6379`;
      case 'mongodb':
        return `mongodb://admin:password@${baseUrl}:27017/app`;
      default:
        return '';
    }
  }

  // API endpoints this plugin provides
  getApiRoutes() {
    return {
      'GET /api/databases': this.listDatabases.bind(this),
      'POST /api/databases': this.createDatabase.bind(this),
      'DELETE /api/databases/:name': this.deleteDatabase.bind(this),
      'GET /api/databases/:name/connection': this.getConnectionString.bind(this)
    };
  }

  async listDatabases(req, res) {
    try {
      const databases = Array.from(this.databases.values());
      res.json({ databases });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createDatabase(req, res) {
    try {
      const { appName, type } = req.body;
      const dbInfo = await this.provisionDatabase(appName, type);
      res.json({ success: true, database: dbInfo });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteDatabase(req, res) {
    try {
      const { name } = req.params;
      const dbInfo = this.databases.get(name);

      if (!dbInfo) {
        return res.status(404).json({ error: 'Database not found' });
      }

      // Stop and remove container
      const container = this.docker.getContainer(dbInfo.id);
      await container.stop();
      await container.remove();

      this.databases.delete(name);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getConnectionString(req, res) {
    try {
      const { name } = req.params;
      const dbInfo = this.databases.get(name);

      if (!dbInfo) {
        return res.status(404).json({ error: 'Database not found' });
      }

      res.json({ connectionString: dbInfo.connectionString });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async destroy() {
    // Clean up database containers
    for (const [name, dbInfo] of this.databases) {
      try {
        const container = this.docker.getContainer(dbInfo.id);
        await container.stop();
        await container.remove();
        this.api.info(`Cleaned up database: ${name}`);
      } catch (error) {
        this.api.error(`Failed to cleanup database ${name}:`, error);
      }
    }

    this.databases.clear();
    await super.destroy();
  }
}

module.exports = DatabaseProvisioningPlugin;