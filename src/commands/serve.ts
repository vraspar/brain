import { Command } from 'commander';
import { startServer } from '../mcp/server.js';

export const serveCommand = new Command('serve')
  .description('Start the Brain MCP server (stdio transport)')
  .action(async () => {
    try {
      console.error('🧠 Brain MCP server running on stdio...');
      console.error('   Press Ctrl+C to stop.\n');
      await startServer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to start Brain MCP server: ${message}`);
      process.exit(1);
    }
  });
