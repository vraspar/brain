import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createEntry, scanEntries, serializeEntry, writeEntry } from '../core/entry.js';
import {
  getAllEntries,
  getEntriesByAuthor,
  getEntriesWithFreshness,
  getEntryById,
  getRecentEntries,
  rebuildIndex,
  resolveEntryId,
  searchEntries,
} from '../core/index-db.js';
import { computeFreshness } from '../core/freshness.js';
import { buildUsageStatsMap } from '../core/freshness-stats.js';
import { getStats, recordReceipt } from '../core/receipts.js';
import { getTrailEntries } from '../core/links.js';
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
  registerListEntries(server, context);
  registerExploreTopic(server, context);
  registerRetractEntry(server, context);
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
        if (!content.trim()) {
          return {
            content: [{ type: 'text' as const, text: '❌ Content cannot be empty.' }],
            isError: true,
          };
        }

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
        const { entry } = resolveEntryId(context.db, id);

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
        // Extract keywords: tech terms + significant words (filter stop words)
        const techKeywords = extractTags(topic);
        const words = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const allKeywords = [...new Set([...techKeywords, ...words])];
        const searchQuery = allKeywords.length > 0 ? allKeywords.join(' ') : topic;

        // Strategy 1: FTS5 search on the topic (exclude archived entries)
        const searchResults = searchEntries(context.db, searchQuery, limit * 2)
          .filter((entry) => entry.status !== 'archived');

        // Strategy 2: Tag overlap scoring for active entries only
        const allEntries = getAllEntries(context.db)
          .filter((entry) => entry.status !== 'archived');
        const topicTagSet = new Set(allKeywords.map((k) => k.toLowerCase()));

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
      status: z.enum(['active', 'stale', 'archived']).optional().describe('Set entry status — WARNING: setting "archived" effectively hides the entry from search, digest, and recommendations'),
    },
    async ({ id, title, tags, type, summary, content, status }) => {
      try {
        const { entry: existing } = resolveEntryId(context.db, id);

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

        // Clear source_content_hash if content was modified, so brain sources sync
        // won't overwrite agent edits (treats entry as "locally modified")
        if (content !== undefined && updated.source_content_hash) {
          updated.source_content_hash = undefined;
        }

        // Write updated entry to disk
        const filePath = await writeEntry(context.config.local, updated);

        // Commit the change
        try {
          const skipPush = !context.config.remote;
          await commitAndPush(
            context.config.local,
            [filePath],
            `Update ${updated.type}: ${updated.title} (via MCP)`,
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

// --- list_entries ---

function registerListEntries(server: McpServer, context: BrainMcpContext): void {
  server.tool(
    'list_entries',
    {
      type: z.enum(['guide', 'skill']).optional().describe('Filter by entry type'),
      tag: z.string().optional().describe('Filter by tag'),
      author: z.string().optional().describe('Filter by author'),
      fresh_only: z.boolean().default(false).describe('Only return fresh entries'),
      limit: z.number().default(20).describe('Maximum number of entries'),
    },
    async ({ type, tag, author, fresh_only, limit }) => {
      try {
        let entries: Entry[];

        if (author) {
          entries = getEntriesByAuthor(context.db, author);
        } else {
          entries = getAllEntries(context.db);
        }

        // Exclude archived
        entries = entries.filter((e) => e.status !== 'archived');

        if (type) {
          entries = entries.filter((e) => e.type === type);
        }

        if (tag) {
          const lowerTag = tag.toLowerCase();
          entries = entries.filter((e) => e.tags.some((t) => t.toLowerCase() === lowerTag));
        }

        // Apply freshness filter
        if (fresh_only) {
          const usageStats = buildUsageStatsMap(context.config.local, '30d');
          entries = entries.filter((e) => {
            const f = computeFreshness(e, usageStats.get(e.id));
            return f.label === 'fresh';
          });
        }

        entries = entries.slice(0, limit);

        // Build response with freshness info
        const usageStats = buildUsageStatsMap(context.config.local, '30d');
        const items = entries.map((e) => {
          const f = computeFreshness(e, usageStats.get(e.id));
          return {
            id: e.id,
            title: e.title,
            type: e.type,
            author: e.author,
            tags: e.tags,
            freshness: f.label,
          };
        });

        const text = items.length === 0
          ? 'No entries found.'
          : items.map((i) => `${i.id} — ${i.title} (${i.type}, ${i.freshness})`).join('\n');

        return {
          content: [{ type: 'text' as const, text: `Found ${items.length} entries:\n\n${text}` }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `❌ Failed to list entries: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

// --- explore_topic ---

function registerExploreTopic(server: McpServer, context: BrainMcpContext): void {
  server.tool(
    'explore_topic',
    {
      topic: z.string().describe('Topic to explore — finds related entries via search + knowledge trail'),
      limit: z.number().default(5).describe('Maximum number of entries to return'),
    },
    async ({ topic, limit }) => {
      try {
        const trail = getTrailEntries(context.db, topic, limit);

        if (trail.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No entries found for topic "${topic}".` }],
          };
        }

        const parts = trail.map((t) => {
          const related = t.related.length > 0
            ? `\n  Related: ${t.related.map((r) => `${r.id} (${r.title})`).join(', ')}`
            : '';
          return `**${t.entry.title}** (${t.entry.type})\n  ID: ${t.entry.id} | Tags: ${t.entry.tags.join(', ') || 'none'}${related}`;
        });

        return {
          content: [{ type: 'text' as const, text: `Knowledge trail for "${topic}" (${trail.length} entries):\n\n${parts.join('\n\n')}` }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `❌ Failed to explore topic: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

// --- Keyword extraction for recommendations ---

const STOP_WORDS = new Set([
  'i', 'im', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'its',
  'they', 'them', 'this', 'that', 'these', 'those', 'a', 'an', 'the', 'and',
  'but', 'or', 'for', 'nor', 'not', 'so', 'yet', 'to', 'of', 'in', 'on', 'at',
  'by', 'from', 'with', 'about', 'into', 'through', 'during', 'before', 'after',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'can', 'shall', 'need', 'get', 'got', 'how', 'what', 'when', 'where', 'why',
  'which', 'who', 'whom', 'if', 'then', 'than', 'just', 'very', 'also', 'some',
  'any', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'no', 'up', 'out', 'off', 'over', 'under', 'again', 'here', 'there',
]);

function extractSignificantWords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 10);
}

// --- retract_entry ---

function registerRetractEntry(server: McpServer, context: BrainMcpContext): void {
  server.tool(
    'retract_entry',
    {
      id: z.string().describe('Entry ID (slug) to retract — archives the entry (reversible)'),
    },
    async ({ id }) => {
      try {
        const { entry } = resolveEntryId(context.db, id);
        const fullPath = path.join(context.config.local, entry.filePath);
        const archivePath = path.join(context.config.local, '_archive', entry.filePath);

        if (!fs.existsSync(fullPath)) {
          return {
            content: [{ type: 'text' as const, text: `❌ Entry file not found at "${entry.filePath}".` }],
            isError: true,
          };
        }

        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = matter(raw);
        const newData = { ...parsed.data, status: 'archived', archived_at: new Date().toISOString(), archived_reason: 'retracted' };
        const updated = matter.stringify(parsed.content, newData);

        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        fs.writeFileSync(archivePath, updated, 'utf-8');
        fs.unlinkSync(fullPath);

        try {
          await commitAndPush(context.config.local, [entry.filePath, `_archive/${entry.filePath}`], `Retract ${entry.type}: ${entry.title}`, { skipPush: !context.config.remote });
        } catch { /* commit may fail */ }

        const entries = await scanEntries(context.config.local);
        rebuildIndex(context.db, entries);

        return { content: [{ type: 'text' as const, text: `✅ Retracted: ${entry.title}\nArchived to: _archive/${entry.filePath}\nRestore with: brain restore ${entry.id}` }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `❌ Failed to retract: ${message}` }], isError: true };
      }
    },
  );
}
