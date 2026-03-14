const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Plugin = require('../../src/Plugin.js');

/**
 * Discord Notifier Plugin for ANCHOR
 * Sends notifications to Discord channels for server events
 */
class DiscordNotifierPlugin extends Plugin {
  constructor(options) {
    super(options);
    this.name = 'anchor-discord-notifier';
    this.version = '1.0.0';
    this.description = 'Discord notification plugin for ANCHOR';

    // Events this plugin listens to
    this.events = [
      'serverCreated',
      'serverStart',
      'serverStop',
      'serverRestart',
      'scalingUp',
      'scalingDown',
      'costOptimization'
    ];

    this.client = null;
    this.notificationChannel = null;
  }

  async init(api) {
    await super.init(api);

    const token = this.getConfig('discordToken');
    const channelId = this.getConfig('channelId');

    if (!token) {
      this.api.warn('Discord token not configured. Set discordToken in plugin config.');
      return;
    }

    if (!channelId) {
      this.api.warn('Discord channel ID not configured. Set channelId in plugin config.');
      return;
    }

    // Initialize Discord client
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
    });

    this.client.once('ready', () => {
      this.api.info(`Discord bot logged in as ${this.client.user.tag}`);
      this.notificationChannel = this.client.channels.cache.get(channelId);
      if (!this.notificationChannel) {
        this.api.error(`Could not find Discord channel with ID ${channelId}`);
      }
    });

    this.client.on('error', (error) => {
      this.api.error(`Discord client error: ${error.message}`);
    });

    try {
      await this.client.login(token);
    } catch (error) {
      this.api.error(`Failed to login to Discord: ${error.message}`);
    }
  }

  async destroy() {
    if (this.client) {
      this.client.destroy();
    }
    await super.destroy();
  }

  onEvent(event, data) {
    if (!this.notificationChannel) return;

    const embed = this.createEmbed(event, data);
    if (embed) {
      this.notificationChannel.send({ embeds: [embed] }).catch(error => {
        this.api.error(`Failed to send Discord notification: ${error.message}`);
      });
    }
  }

  createEmbed(event, data) {
    const embed = new EmbedBuilder()
      .setColor(this.getEventColor(event))
      .setTimestamp()
      .setFooter({ text: 'ANCHOR Game Server Platform' });

    switch (event) {
      case 'serverCreated':
        embed.setTitle('🆕 Server Created')
            .setDescription(`A new ${data.type} server has been created`)
            .addFields(
              { name: 'Server ID', value: data.serverId, inline: true },
              { name: 'Type', value: data.type, inline: true },
              { name: 'Region', value: data.region || 'default', inline: true },
              { name: 'Node', value: data.nodeId, inline: true }
            );
        break;

      case 'serverStart':
        embed.setTitle('▶️ Server Started')
            .setDescription(`Server ${data.serverId} has started successfully`)
            .setColor(0x00ff00);
        break;

      case 'serverStop':
        embed.setTitle('⏹️ Server Stopped')
            .setDescription(`Server ${data.serverId} has been stopped`)
            .setColor(0xff0000);
        break;

      case 'serverRestart':
        embed.setTitle('🔄 Server Restarted')
            .setDescription(`Server ${data.serverId} has been restarted`)
            .setColor(0xffff00);
        break;

      case 'scalingUp':
        embed.setTitle('📈 Auto Scaling: Scale Up')
            .setDescription('ANCHOR automatically scaled up server capacity')
            .addFields(
              { name: 'Original Server', value: data.originalServer, inline: true },
              { name: 'New Server', value: data.newServer, inline: true },
              { name: 'Node', value: data.node.nodeId, inline: true }
            )
            .setColor(0x00ff00);
        break;

      case 'scalingDown':
        embed.setTitle('📉 Auto Scaling: Scale Down')
            .setDescription('ANCHOR automatically scaled down server capacity')
            .addFields(
              { name: 'Server', value: data.serverId, inline: true }
            )
            .setColor(0xffa500);
        break;

      case 'costOptimization':
        embed.setTitle('💰 Cost Optimization')
            .setDescription('ANCHOR shut down idle server to save costs')
            .addFields(
              { name: 'Server', value: data.serverId, inline: true }
            )
            .setColor(0x008000);
        break;

      default:
        return null; // Don't send embed for unknown events
    }

    return embed;
  }

  getEventColor(event) {
    const colors = {
      serverCreated: 0x3498db,
      serverStart: 0x00ff00,
      serverStop: 0xff0000,
      serverRestart: 0xffff00,
      scalingUp: 0x00ff00,
      scalingDown: 0xffa500,
      costOptimization: 0x008000
    };
    return colors[event] || 0x7289da;
  }
}

module.exports = DiscordNotifierPlugin;