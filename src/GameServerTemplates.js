/**
 * GameServerTemplates - Pre-configured templates for popular game servers
 * Each template includes Docker image, ports, environment variables, and resource recommendations
 */
class GameServerTemplates {
  static getTemplate(gameType) {
    const templates = {
      minecraft: {
        image: 'itzg/minecraft-server',
        ports: [
          { container: '25565', host: '25565' }, // TCP
          { container: '25565/udp', host: '25565' } // UDP
        ],
        env: {
          EULA: 'TRUE',
          VERSION: 'LATEST',
          TYPE: 'VANILLA',
          DIFFICULTY: 'normal',
          MAX_PLAYERS: '20',
          MOTD: 'ANCHOR Minecraft Server'
        },
        resources: {
          memory: '2048m', // 2GB
          cpus: '1.0'
        },
        volumes: [
          './minecraft-data:/data'
        ]
      },

      'csgo': {
        image: 'cm2network/csgo',
        ports: [
          { container: '27015', host: '27015' }, // Game port
          { container: '27015/udp', host: '27015' },
          { container: '27020', host: '27020' }, // SourceTV
          { container: '27020/udp', host: '27020' }
        ],
        env: {
          SRCDS_TOKEN: '', // Steam token needed
          SRCDS_RCONPW: 'changeme',
          SRCDS_PW: '',
          SRCDS_MAXPLAYERS: '16',
          SRCDS_STARTMAP: 'de_dust2'
        },
        resources: {
          memory: '4096m', // 4GB
          cpus: '2.0'
        },
        volumes: [
          './csgo-data:/home/steam/csgo-dedicated'
        ]
      },

      rust: {
        image: 'didstopia/rust-server',
        ports: [
          { container: '28015', host: '28015' }, // Game port
          { container: '28015/udp', host: '28015' },
          { container: '28016', host: '28016' }, // RCON
          { container: '28016/udp', host: '28016' },
          { container: '28082', host: '28082' }, // Web
          { container: '28083', host: '28083' }  // App
        ],
        env: {
          RUST_SERVER_STARTUP_ARGUMENTS: '-batchmode -load +server.worldsize 3000 +server.maxplayers 50 +server.hostname "ANCHOR Rust Server" +server.description "Powered by ANCHOR"',
          RUST_RCON_PASSWORD: 'changeme',
          RUST_UPDATE_CHECKING: '0',
          RUST_UPDATE_BRANCH: 'public'
        },
        resources: {
          memory: '8192m', // 8GB
          cpus: '2.0'
        },
        volumes: [
          './rust-data:/steamcmd/rust'
        ]
      },

      valheim: {
        image: 'lloesche/valheim-server',
        ports: [
          { container: '2456', host: '2456' }, // Game port
          { container: '2456/udp', host: '2456' },
          { container: '2457', host: '2457' }, // Query port
          { container: '2457/udp', host: '2457' },
          { container: '2458', host: '2458' }  // Steam port
        ],
        env: {
          SERVER_NAME: 'ANCHOR Valheim Server',
          WORLD_NAME: 'Dedicated',
          SERVER_PASS: 'changeme',
          SERVER_PUBLIC: '1'
        },
        resources: {
          memory: '4096m', // 4GB
          cpus: '1.0'
        },
        volumes: [
          './valheim-data:/config',
          './valheim-saves:/opt/valheim'
        ]
      }
    };

    return templates[gameType] || null;
  }

  static getAvailableGames() {
    return Object.keys({
      minecraft: {},
      csgo: {},
      rust: {},
      valheim: {}
    });
  }

  static customizeTemplate(template, customizations = {}) {
    const customized = JSON.parse(JSON.stringify(template)); // Deep copy

    // Override environment variables
    if (customizations.env) {
      customized.env = { ...customized.env, ...customizations.env };
    }

    // Override ports if specified
    if (customizations.ports) {
      customized.ports = customizations.ports;
    }

    // Override resources
    if (customizations.resources) {
      customized.resources = { ...customized.resources, ...customizations.resources };
    }

    // Add additional volumes
    if (customizations.volumes) {
      customized.volumes = [...(customized.volumes || []), ...customizations.volumes];
    }

    return customized;
  }
}

module.exports = GameServerTemplates;