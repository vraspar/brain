import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, rebuildIndex } from '../core/index-db.js';
import { scanEntries } from '../core/entry.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import type { BrainConfig } from '../types.js';
import type Database from 'better-sqlite3';

export interface BrainMcpContext {
  config: BrainConfig;
  db: Database.Database;
}

/**
 * Create and configure the Brain MCP server with all tools and resources.
 * Returns the server instance (useful for testing without connecting transport).
 */
export function createBrainServer(): { server: McpServer; context: BrainMcpContext } {
  const config = loadConfig();

  const dbPath = getDbPath();
  const db = createIndex(dbPath);

  const context: BrainMcpContext = { config, db };

  const server = new McpServer({
    name: 'brain',
    version: '0.1.0',
  });

  registerTools(server, context);
  registerResources(server, context);

  return { server, context };
}

/**
 * Initialize the index from disk entries.
 * Call this after creating the server to populate the search index.
 */
export async function initializeIndex(context: BrainMcpContext): Promise<void> {
  const entries = await scanEntries(context.config.local);
  rebuildIndex(context.db, entries);
}

/**
 * Start the Brain MCP server with stdio transport.
 * This is the main entry point for `brain serve`.
 */
export async function startServer(): Promise<void> {
  const { server, context } = createBrainServer();

  await initializeIndex(context);

  // Graceful shutdown: close DB to prevent WAL corruption
  const shutdown = () => {
    try {
      context.db.close();
    } catch {
      // DB may already be closed
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
