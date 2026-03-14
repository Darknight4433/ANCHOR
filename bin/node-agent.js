#!/usr/bin/env node

const NodeAgent = require('../src/NodeAgent.js');
require('dotenv').config();

async function main() {
  const config = {
    port: process.env.NODE_AGENT_PORT || 3001,
    host: process.env.NODE_AGENT_HOST || '0.0.0.0',
    controllerUrl: process.env.CONTROLLER_URL || 'http://localhost:3000',
    nodeId: process.env.NODE_ID,
    region: process.env.NODE_REGION || 'default'
  };

  const agent = new NodeAgent(config);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down NodeAgent...');
    await agent.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down NodeAgent...');
    await agent.stop();
    process.exit(0);
  });

  try {
    await agent.start();
    console.log(`⚓ ANCHOR NodeAgent started successfully`);
    console.log(`Node ID: ${config.nodeId || 'auto-generated'}`);
    console.log(`Region: ${config.region}`);
    console.log(`Controller: ${config.controllerUrl}`);
  } catch (error) {
    console.error('Failed to start NodeAgent:', error);
    process.exit(1);
  }
}

main();