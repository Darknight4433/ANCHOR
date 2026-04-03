const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const fse = require('fs-extra');
const Validator = require('./Validator.js');

class GitDeploymentService {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), '.anchor', 'git-deployments.json');
    this.workspaceRoot = options.workspaceRoot || path.join(os.tmpdir(), 'anchor-git-deployments');
    fse.ensureDirSync(path.dirname(this.storagePath));
    fse.ensureDirSync(this.workspaceRoot);
  }

  listDeployments(filters = {}) {
    const deployments = this._loadDeployments();
    return deployments.filter((deployment) => {
      if (filters.name && deployment.name !== filters.name) {
        return false;
      }
      return true;
    });
  }

  getRollbackTarget(name, selector = {}) {
    const history = this.listDeployments({ name }).filter(
      (deployment) => deployment.status === 'deployed' && deployment.imageTag
    );

    if (selector.deploymentId) {
      return history.find((deployment) => deployment.id === selector.deploymentId) || null;
    }

    if (selector.version) {
      return history.find((deployment) => deployment.version === selector.version) || null;
    }

    return history[1] || null;
  }

  async prepareDeployment(input) {
    Validator.validateRepositoryReference(input.repo);

    const deploymentId = this._generateId();
    const sourceName = input.name || this._deriveNameFromRepo(input.repo);
    Validator.validateProcessName(sourceName);

    const version = this._nextVersion(sourceName);
    const stagingPath = path.join(this.workspaceRoot, deploymentId);
    await this._prepareSource(input.repo, input.ref, stagingPath);

    const detected = await this._detectProject(stagingPath, input.type);

    return {
      id: deploymentId,
      name: sourceName,
      version,
      repo: input.repo,
      ref: input.ref || 'default',
      requestedType: input.type || 'auto',
      deploymentType: detected.deploymentType,
      runtime: detected.runtime,
      internalPort: detected.internalPort,
      env: input.env || {},
      region: input.region || null,
      domain: input.domain || null,
      sourcePath: stagingPath,
      build: detected.build,
      metadata: detected.metadata,
      status: 'prepared',
      createdAt: new Date().toISOString()
    };
  }

  recordDeployment(deployment) {
    const deployments = this._loadDeployments();
    deployments.unshift(deployment);
    this._saveDeployments(deployments);
    return deployment;
  }

  createRollbackRecord(sourceDeployment, result) {
    const version = this._nextVersion(sourceDeployment.name);
    const record = {
      id: this._generateId(),
      name: sourceDeployment.name,
      version,
      repo: sourceDeployment.repo,
      ref: sourceDeployment.ref,
      requestedType: sourceDeployment.requestedType || sourceDeployment.deploymentType,
      deploymentType: sourceDeployment.deploymentType,
      runtime: sourceDeployment.runtime,
      internalPort: sourceDeployment.internalPort,
      env: sourceDeployment.env || {},
      region: result.region || sourceDeployment.region || null,
      domain: result.domain || sourceDeployment.domain || null,
      imageTag: sourceDeployment.imageTag,
      sourceDeploymentId: sourceDeployment.id,
      status: 'deployed',
      createdAt: new Date().toISOString(),
      metadata: {
        ...(sourceDeployment.metadata || {}),
        rollback: true
      },
      ...result
    };

    return this.recordDeployment(record);
  }

  _loadDeployments() {
    if (!fs.existsSync(this.storagePath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  _saveDeployments(deployments) {
    fs.writeFileSync(this.storagePath, JSON.stringify(deployments, null, 2));
  }

  _nextVersion(name) {
    const existing = this.listDeployments({ name });
    return existing.length + 1;
  }

  _deriveNameFromRepo(repo) {
    const normalized = repo.replace(/[\\/]+$/, '');
    const base = path.basename(normalized).replace(/\.git$/i, '') || 'app';
    const slug = base.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'app';
  }

  async _prepareSource(repo, ref, stagingPath) {
    if (fs.existsSync(repo)) {
      await fse.copy(repo, stagingPath, {
        filter: (source) => !source.includes(`${path.sep}.git${path.sep}`) && path.basename(source) !== '.git'
      });
      return;
    }

    const args = ['clone', '--depth', '1'];
    if (ref) {
      args.push('--branch', ref);
    }
    args.push(repo, stagingPath);
    await this._runGit(args);
  }

  async _detectProject(stagingPath, requestedType = 'auto') {
    const packageJsonPath = path.join(stagingPath, 'package.json');
    const dockerfilePath = path.join(stagingPath, 'Dockerfile');
    const requirementsPath = path.join(stagingPath, 'requirements.txt');
    const serverPropertiesPath = path.join(stagingPath, 'server.properties');

    if (fs.existsSync(serverPropertiesPath)) {
      return {
        deploymentType: requestedType === 'auto' ? 'game' : requestedType,
        runtime: 'game-server',
        internalPort: 25565,
        build: {
          strategy: 'dockerfile',
          contextPath: stagingPath,
          dockerfilePath: fs.existsSync(dockerfilePath) ? dockerfilePath : null
        },
        metadata: {
          detectedFrom: 'server.properties'
        }
      };
    }

    if (fs.existsSync(dockerfilePath)) {
      const packageJson = fs.existsSync(packageJsonPath) ? this._readJson(packageJsonPath) : null;
      return {
        deploymentType: this._resolveDeploymentType(requestedType, packageJson),
        runtime: 'dockerfile',
        internalPort: this._inferPort(packageJson, 3000),
        build: {
          strategy: 'dockerfile',
          contextPath: stagingPath,
          dockerfilePath
        },
        metadata: {
          detectedFrom: 'Dockerfile'
        }
      };
    }

    if (fs.existsSync(packageJsonPath)) {
      const packageJson = this._readJson(packageJsonPath);
      const deploymentType = this._resolveDeploymentType(requestedType, packageJson);
      const generatedDockerfilePath = path.join(stagingPath, 'Dockerfile.anchor');
      fs.writeFileSync(generatedDockerfilePath, this._createNodeDockerfile(packageJson, deploymentType));

      return {
        deploymentType,
        runtime: 'node',
        internalPort: deploymentType === 'service' ? 8000 : 3000,
        build: {
          strategy: 'generated-node',
          contextPath: stagingPath,
          dockerfilePath: generatedDockerfilePath
        },
        metadata: {
          detectedFrom: 'package.json',
          packageName: packageJson.name || null
        }
      };
    }

    if (fs.existsSync(requirementsPath)) {
      const generatedDockerfilePath = path.join(stagingPath, 'Dockerfile.anchor');
      fs.writeFileSync(generatedDockerfilePath, this._createPythonDockerfile());

      return {
        deploymentType: requestedType === 'auto' ? 'service' : requestedType,
        runtime: 'python',
        internalPort: 8000,
        build: {
          strategy: 'generated-python',
          contextPath: stagingPath,
          dockerfilePath: generatedDockerfilePath
        },
        metadata: {
          detectedFrom: 'requirements.txt'
        }
      };
    }

    throw new Error('Unsupported repository layout. Add a Dockerfile, package.json, requirements.txt, or game server config.');
  }

  _resolveDeploymentType(requestedType, packageJson) {
    if (requestedType && requestedType !== 'auto') {
      return requestedType;
    }

    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    if (allDeps['discord.js']) {
      return 'service';
    }

    if (allDeps.next || allDeps.react || allDeps.vite) {
      return 'web';
    }

    if (allDeps.express || allDeps.fastify || allDeps['@nestjs/core']) {
      return 'service';
    }

    return 'web';
  }

  _inferPort(packageJson, fallbackPort) {
    if (!packageJson || !packageJson.config || !packageJson.config.port) {
      return fallbackPort;
    }

    const parsed = parseInt(packageJson.config.port, 10);
    return Number.isInteger(parsed) ? parsed : fallbackPort;
  }

  _readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  _createNodeDockerfile(packageJson, deploymentType) {
    const startScript = packageJson?.scripts?.start ? 'npm start' : 'node index.js';
    const internalPort = deploymentType === 'service' ? 8000 : 3000;

    return [
      'FROM node:20-alpine',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm install --omit=dev || npm install --production || npm install',
      'COPY . .',
      `EXPOSE ${internalPort}`,
      `CMD ["sh", "-c", "${startScript}"]`
    ].join('\n');
  }

  _createPythonDockerfile() {
    return [
      'FROM python:3.11-slim',
      'WORKDIR /app',
      'COPY requirements.txt ./',
      'RUN pip install --no-cache-dir -r requirements.txt',
      'COPY . .',
      'EXPOSE 8000',
      'CMD ["python", "app.py"]'
    ].join('\n');
  }

  _runGit(args) {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { stdio: 'pipe' });
      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || 'git clone failed'));
      });

      child.on('error', (error) => {
        reject(new Error(`git unavailable: ${error.message}`));
      });
    });
  }

  _generateId() {
    return `gitdep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

module.exports = GitDeploymentService;
