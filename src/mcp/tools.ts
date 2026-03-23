import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createEntry, writeEntry } from '../core/entry.js';
import {
  getEntryById,
  getRecentEntries,
  rebuildIndex,
  searchEntries,
} from '../core/index-db.js';
import { scanEntries } from '../core/entry.js';
import { getStats, recordReceipt } from '../core/receipts.js';
import { commitAndPush } from '../utils/git.js';
import { parseTimeWindow } from '../utils/time.js';
import type { BrainMcpContext } from './server.js';
import type { Entry, EntryType } from '../types.js';

/**
 * Register all Brain MCP tools on the server.
 */
export function registerTools(server: McpServer, context: BrainMcpContext): void {
  registerPushKnowledge(server, context);
  registerSearchKnowledge(server, context);
  registerWhatsNew(server, context);
  registerGetEntry(server, context);
  registerBrainStats(server, context);
}

function registerPushKnowledge(server: McpServer, context: BrainMcpContext): void {
  server.tool(
    'push_knowledge',
    {
      title: z.string().describe('Title of the knowledge entry'),
      content: z.string().describe('Markdown content of the entry'),
      type: z.enum(['guide', 'skill']).default('guide').describe('Entry type: guide or skill'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      summary: z.string().optional().describe('Brief summary of the entry'),
    },
    async ({ title, content, type, tags, summary }) => {
      try {
        const entry = createEntry({
          title,
          content,
          type: type as EntryType,
          author: context.config.author,
          tags,
          summary,
        });

        const filePath = await writeEntry(context.config.local, entry);

        try {
          const skipPush = !context.config.remote;
          await commitAndPush(
            context.config.local,
            [filePath],
            `Add ${entry.type}: ${entry.title}`,
            { skipPush },
          );
        } catch {
          // Push may fail if no remote — entry is still written locally
        }

        // Rebuild index to include the new entry
        const entries = await scanEntries(context.config.local);
        rebuildIndex(context.db, entries);

        return {
          content: [{
            type: 'text' as const,
            text: `✅ Published "${entry.title}" (${entry.type})\nID: ${entry.id}\nPath: ${filePath}\nTags: ${entry.tags.join(', ') || 'none'}`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `❌ Failed to push knowledge: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

function registerSearchKnowledge(server: McpServer, context: BrainMcpContext): void {
  server.tool(
    'search_knowledge',
    {
      query: z.string().describe('Search query (supports full-text search)'),
      type: z.enum(['guide', 'skill']).optional().describe('Filter by entry type'),
      limit: z.number().default(10).describe('Maximum number of results'),
    },
    async ({ query, type, limit }) => {
      try {
        let results = searchEntries(context.db, query, limit);

        if (type) {
          results = results.filter((entry) => entry.type === type);
        }

        // Record receipts for viewed results
        for (const entry of results) {
          await recordReceipt(context.config.local, entry.id, context.config.author, 'mcp');
        }

        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No entries found matching "${query}".` }],
          };
        }

        const formatted = results.map(formatEntryCompact).join('\n\n');
        return {
          content: [{
            type: 'text' as const,
            text: `Found ${results.length} result${results.length === 1 ? '' : 's'}:\n\n${formatted}`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `❌ Search failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

function registerWhatsNew(server: McpServer, context: BrainMcpContext): void {
  server.tool(
    'whats_new',
    {
      since: z.string().default('7d').describe('Time window: e.g. 7d, 2w, 1m'),
      type: z.enum(['guide', 'skill']).optional().describe('Filter by entry type'),
    },
    async ({ since, type }) => {
      try {
        const sinceDate = parseTimeWindow(since);
        let entries = getRecentEntries(context.db, sinceDate);

        if (type) {
          entries = entries.filter((entry) => entry.type === type);
        }

        if (entries.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No new or updated entries in the last ${since}.` }],
          };
        }

        const formatted = entries.map(formatEntryCompact).join('\n\n');
        return {
          content: [{
            type: 'text' as const,
            text: `📋 ${entries.length} entries from the last ${since}:\n\n${formatted}`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `❌ Failed to get recent entries: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

function registerGetEntry(server: McpServer, context: BrainMcpContext): void {
  server.tool(
    'get_entry',
    {
      id: z.string().describe('Entry ID (slug) to retrieve'),
    },
    async ({ id }) => {
      try {
        const entry = getEntryById(context.db, id);

        if (!entry) {
          return {
            content: [{
              type: 'text' as const,
              text: `Entry "${id}" not found. Use search_knowledge to find entries.`,
            }],
            isError: true,
          };
        }

        await recordReceipt(context.config.local, entry.id, context.config.author, 'mcp');

        return {
          content: [{
            type: 'text' as const,
            text: formatEntryFull(entry),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `❌ Failed to get entry: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

function registerBrainStats(server: McpServer, context: BrainMcpContext): void {
  server.tool(
    'brain_stats',
    {
      author: z.string().optional().describe('Author to filter stats for (default: current user)'),
      period: z.string().default('7d').describe('Time period: e.g. 7d, 2w, 1m'),
    },
    async ({ author, period }) => {
      try {
        const targetAuthor = author ?? context.config.author;
        const stats = getStats(context.config.local, targetAuthor, period);

        // Resolve titles from the index
        for (const stat of stats) {
          const entry = getEntryById(context.db, stat.entryId);
          if (entry) {
            stat.title = entry.title;
          }
        }

        if (stats.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No read activity for ${targetAuthor}'s entries in the last ${period}.`,
            }],
          };
        }

        const lines = stats.map(
          (s) => `- **${s.title}**: ${s.accessCount} reads, ${s.uniqueReaders} unique readers`,
        );

        return {
          content: [{
            type: 'text' as const,
            text: `📊 Stats for ${targetAuthor} (${period}):\n\n${lines.join('\n')}`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `❌ Failed to get stats: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

// --- Formatting helpers ---

function formatEntryCompact(entry: Entry): string {
  const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
  const summary = entry.summary ? `\n  ${entry.summary}` : '';
  return `**${entry.title}** (${entry.type}) by ${entry.author}${tags}${summary}\n  ID: ${entry.id} | Updated: ${entry.updated}`;
}

function formatEntryFull(entry: Entry): string {
  const parts = [
    `# ${entry.title}`,
    `**Author:** ${entry.author} | **Type:** ${entry.type} | **Status:** ${entry.status}`,
    `**Tags:** ${entry.tags.join(', ') || 'none'}`,
    `**Created:** ${entry.created} | **Updated:** ${entry.updated}`,
  ];

  if (entry.summary) parts.push(`**Summary:** ${entry.summary}`);
  if (entry.related_repos?.length) parts.push(`**Repos:** ${entry.related_repos.join(', ')}`);
  if (entry.related_tools?.length) parts.push(`**Tools:** ${entry.related_tools.join(', ')}`);

  parts.push('', '---', '', entry.content);

  return parts.join('\n');
}
