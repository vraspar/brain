import { Command } from 'commander';
import { startServer } from '../mcp/server.js';

export const serveCommand = new Command('serve')
  .description('Start the Brain MCP server (stdio transport)')
  .action(async () => {
    try {
      await startServer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to start Brain MCP server: ${message}`);
      process.exit(1);
    }
  });
