import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createEntry, scanEntries, serializeEntry, writeEntry } from '../core/entry.js';
import {
  getAllEntries,
  getEntryById,
  getRecentEntries,
  rebuildIndex,
  searchEntries,
} from '../core/index-db.js';
import { computeFreshness } from '../core/freshness.js';
import { buildUsageStatsMap } from '../core/freshness-stats.js';
import { getStats, recordReceipt } from '../core/receipts.js';
import { commitAndPush } from '../utils/git.js';
import { extractTags } from '../utils/tags.js';
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
  registerGetRecommendations(server, context);
  registerUpdateEntry(server, context);
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

function registerGetRecommendations(server: McpServer, context: BrainMcpContext): void {
  server.tool(
    'get_recommendations',
    {
      topic: z.string().describe('What you are working on — code context, error messages, or a topic description'),
      limit: z.number().default(5).describe('Maximum number of recommendations'),
    },
    async ({ topic, limit }) => {
      try {
        // Extract keywords from the topic using shared tech terms
        const keywords = extractTags(topic);
        const searchQuery = keywords.length > 0 ? keywords.join(' ') : topic;

        // Strategy 1: FTS5 search on the topic (exclude archived entries)
        const searchResults = searchEntries(context.db, searchQuery, limit * 2)
          .filter((entry) => entry.status !== 'archived');

        // Strategy 2: Tag overlap scoring for active entries only
        const allEntries = getAllEntries(context.db)
          .filter((entry) => entry.status !== 'archived');
        const topicTagSet = new Set(keywords.map((k) => k.toLowerCase()));

        const tagScored = allEntries
          .filter((entry) => !searchResults.some((r) => r.id === entry.id))
          .map((entry) => {
            const overlap = entry.tags.filter((t) => topicTagSet.has(t.toLowerCase())).length;
            return { entry, overlap };
          })
          .filter(({ overlap }) => overlap > 0)
          .sort((a, b) => b.overlap - a.overlap);

        // Strategy 3: Freshness boost — prefer fresh entries
        const usageStats = buildUsageStatsMap(context.config.local, '30d');
        const allCandidates: Array<{ entry: Entry; score: number; reason: string }> = [];

        for (const entry of searchResults) {
          const freshness = computeFreshness(entry, usageStats.get(entry.id));
          const score = 0.7 + freshness.score * 0.3; // FTS relevance + freshness bonus
          allCandidates.push({ entry, score, reason: 'content match' });
        }

        for (const { entry, overlap } of tagScored) {
          const freshness = computeFreshness(entry, usageStats.get(entry.id));
          const score = overlap * 0.3 + freshness.score * 0.2;
          allCandidates.push({ entry, score, reason: `${overlap} shared tag${overlap > 1 ? 's' : ''}` });
        }

        // Deduplicate, sort by score, take top N
        const seen = new Set<string>();
        const recommendations = allCandidates
          .filter(({ entry }) => {
            if (seen.has(entry.id)) return false;
            seen.add(entry.id);
            return true;
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        if (recommendations.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No relevant entries found for topic: "${topic}". Try pushing related knowledge with push_knowledge.`,
            }],
          };
        }

        // Record receipts for recommended entries
        for (const rec of recommendations) {
          await recordReceipt(context.config.local, rec.entry.id, context.config.author, 'mcp');
        }

        const formatted = recommendations
          .map((rec, i) => {
            const tags = rec.entry.tags.length > 0 ? ` [${rec.entry.tags.join(', ')}]` : '';
            const summary = rec.entry.summary ? `\n  ${rec.entry.summary}` : '';
            return `${i + 1}. **${rec.entry.title}** (${rec.reason})${tags}${summary}\n   ID: ${rec.entry.id}`;
          })
          .join('\n\n');

        return {
          content: [{
            type: 'text' as const,
            text: `🧠 ${recommendations.length} recommendation${recommendations.length === 1 ? '' : 's'} for "${topic}":\n\n${formatted}`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `❌ Recommendations failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

function registerUpdateEntry(server: McpServer, context: BrainMcpContext): void {
  server.tool(
    'update_entry',
    {
      id: z.string().describe('Entry ID (slug) to update'),
      title: z.string().optional().describe('New title'),
      tags: z.array(z.string()).optional().describe('Replace tags'),
      type: z.enum(['guide', 'skill']).optional().describe('Change entry type'),
      summary: z.string().optional().describe('New summary'),
      content: z.string().optional().describe('Replace markdown content body'),
      status: z.enum(['active', 'stale', 'archived']).optional().describe('Set entry status'),
    },
    async ({ id, title, tags, type, summary, content, status }) => {
      try {
        const existing = getEntryById(context.db, id);
        if (!existing) {
          return {
            content: [{
              type: 'text' as const,
              text: `Entry "${id}" not found. Use search_knowledge to find entries.`,
            }],
            isError: true,
          };
        }

        // Merge only provided fields
        const updated: Entry = {
          ...existing,
          ...(title !== undefined && { title }),
          ...(tags !== undefined && { tags }),
          ...(type !== undefined && { type }),
          ...(summary !== undefined && { summary }),
          ...(content !== undefined && { content }),
          ...(status !== undefined && { status }),
          updated: new Date().toISOString(),
        };

        // Write updated entry to disk
        const filePath = await writeEntry(context.config.local, updated);

        // Commit the change
        try {
          const skipPush = !context.config.remote;
          await commitAndPush(
            context.config.local,
            [filePath],
            `Update ${updated.type}: ${updated.title}`,
            { skipPush },
          );
        } catch {
          // Push may fail if no remote — entry is still written locally
        }

        // Rebuild index to reflect changes
        const entries = await scanEntries(context.config.local);
        rebuildIndex(context.db, entries);

        const changedFields = [
          title !== undefined && 'title',
          tags !== undefined && 'tags',
          type !== undefined && 'type',
          summary !== undefined && 'summary',
          content !== undefined && 'content',
          status !== undefined && 'status',
        ].filter(Boolean);

        return {
          content: [{
            type: 'text' as const,
            text: `✅ Updated "${updated.title}"\nID: ${updated.id}\nChanged: ${changedFields.join(', ')}\nPath: ${filePath}`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `❌ Failed to update entry: ${message}` }],
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
