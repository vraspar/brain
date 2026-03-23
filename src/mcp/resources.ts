import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEntryById, getRecentEntries } from '../core/index-db.js';
import { getStats } from '../core/receipts.js';
import { parseTimeWindow } from '../utils/time.js';
import type { BrainMcpContext } from './server.js';
import type { Entry } from '../types.js';

/**
 * Register all Brain MCP resources on the server.
 */
export function registerResources(server: McpServer, context: BrainMcpContext): void {
  registerDigestResource(server, context);
  registerStatsResource(server, context);
}

function registerDigestResource(server: McpServer, context: BrainMcpContext): void {
  server.resource(
    'digest',
    'brain://digest',
    { description: 'Recent knowledge entries digest (last 7 days)', mimeType: 'text/markdown' },
    async (uri) => {
      const since = parseTimeWindow('7d');
      const entries = getRecentEntries(context.db, since);

      const markdown = formatDigestMarkdown(entries);

      return {
        contents: [{
          uri: uri.toString(),
          mimeType: 'text/markdown',
          text: markdown,
        }],
      };
    },
  );
}

function registerStatsResource(server: McpServer, context: BrainMcpContext): void {
  server.resource(
    'stats',
    'brain://stats',
    { description: 'Contributor stats summary', mimeType: 'text/markdown' },
    async (uri) => {
      const stats = getStats(context.config.local, context.config.author, '7d');

      // Resolve titles from the index
      for (const stat of stats) {
        const entry = getEntryById(context.db, stat.entryId);
        if (entry) {
          stat.title = entry.title;
        }
      }

      const totalReads = stats.reduce((sum, s) => sum + s.accessCount, 0);
      const totalEntries = stats.length;

      const lines = [
        `# Brain Stats for ${context.config.author}`,
        '',
        `**Entries with activity:** ${totalEntries} | **Total reads:** ${totalReads}`,
        '',
      ];

      if (stats.length > 0) {
        lines.push('| Entry | Reads | Unique Readers |');
        lines.push('|-------|-------|----------------|');
        for (const s of stats.slice(0, 10)) {
          lines.push(`| ${s.title} | ${s.accessCount} | ${s.uniqueReaders} |`);
        }
      } else {
        lines.push('No read activity in the last 7 days.');
      }

      return {
        contents: [{
          uri: uri.toString(),
          mimeType: 'text/markdown',
          text: lines.join('\n'),
        }],
      };
    },
  );
}

// --- Formatting helpers ---

function formatDigestMarkdown(entries: Entry[]): string {
  if (entries.length === 0) {
    return '# Brain Digest\n\nNo new or updated entries in the last 7 days.';
  }

  const lines = [
    `# Brain Digest (${entries.length} entries)`,
    '',
  ];

  for (const entry of entries) {
    const tags = entry.tags.length > 0 ? ` \`${entry.tags.join('` `')}\`` : '';
    lines.push(`## ${entry.title}`);
    lines.push(`*${entry.type}* by **${entry.author}** — ${entry.updated}${tags}`);
    if (entry.summary) {
      lines.push('', entry.summary);
    }
    lines.push('');
  }

  return lines.join('\n');
}
