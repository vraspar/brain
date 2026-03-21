import chalk from 'chalk';
import Table from 'cli-table3';
import type { DigestEntry, Entry, StatsResult } from '../types.js';
import { formatDate, relativeTime } from './time.js';

export interface FormatOptions {
  format?: 'text' | 'json';
}

export function formatEntry(entry: Entry, options: FormatOptions = {}): string {
  if (options.format === 'json') {
    return JSON.stringify(entry, null, 2);
  }

  const statusColor =
    entry.status === 'active' ? chalk.green : entry.status === 'stale' ? chalk.yellow : chalk.gray;

  const lines = [
    chalk.bold.cyan(entry.title),
    `${chalk.dim('Author:')} ${entry.author}  ${chalk.dim('Type:')} ${entry.type}  ${chalk.dim('Status:')} ${statusColor(entry.status)}`,
    `${chalk.dim('Tags:')} ${entry.tags.map((tag) => chalk.blue(`#${tag}`)).join(' ')}`,
    `${chalk.dim('Created:')} ${formatDate(entry.created)}  ${chalk.dim('Updated:')} ${relativeTime(new Date(entry.updated))}`,
  ];

  if (entry.summary) {
    lines.push(`${chalk.dim('Summary:')} ${entry.summary}`);
  }

  if (entry.related_repos?.length) {
    lines.push(`${chalk.dim('Repos:')} ${entry.related_repos.join(', ')}`);
  }

  if (entry.related_tools?.length) {
    lines.push(`${chalk.dim('Tools:')} ${entry.related_tools.join(', ')}`);
  }

  lines.push('', entry.content);

  return lines.join('\n');
}

export function formatDigest(entries: DigestEntry[], options: FormatOptions = {}): string {
  if (options.format === 'json') {
    return JSON.stringify(entries, null, 2);
  }

  if (entries.length === 0) {
    return chalk.dim('No entries found for this period.');
  }

  const newEntries = entries.filter((entry) => entry.isNew);
  const updatedEntries = entries.filter((entry) => !entry.isNew);

  const lines: string[] = [];

  if (newEntries.length > 0) {
    lines.push(chalk.bold.green(`\n✨ New Entries (${newEntries.length})`));
    lines.push(buildDigestTable(newEntries));
  }

  if (updatedEntries.length > 0) {
    lines.push(chalk.bold.blue(`\n📝 Updated Entries (${updatedEntries.length})`));
    lines.push(buildDigestTable(updatedEntries));
  }

  return lines.join('\n');
}

function buildDigestTable(entries: DigestEntry[]): string {
  const table = new Table({
    head: ['Title', 'Author', 'Type', 'Tags', 'Reads'],
    style: { head: ['cyan'] },
  });

  for (const entry of entries) {
    table.push([
      entry.title,
      entry.author,
      entry.type,
      entry.tags.slice(0, 3).join(', '),
      entry.accessCount?.toString() ?? '-',
    ]);
  }

  return table.toString();
}

export function formatStats(stats: StatsResult[], options: FormatOptions = {}): string {
  if (options.format === 'json') {
    return JSON.stringify(stats, null, 2);
  }

  if (stats.length === 0) {
    return chalk.dim('No stats available for this period.');
  }

  const table = new Table({
    head: ['Entry', 'Total Reads', 'Unique Readers', 'Period'],
    style: { head: ['cyan'] },
  });

  for (const stat of stats) {
    table.push([stat.title, stat.accessCount.toString(), stat.uniqueReaders.toString(), stat.period]);
  }

  return table.toString();
}

export function formatSearchResults(entries: Entry[], options: FormatOptions = {}): string {
  if (options.format === 'json') {
    return JSON.stringify(entries, null, 2);
  }

  if (entries.length === 0) {
    return chalk.dim('No matching entries found.');
  }

  const table = new Table({
    head: ['Title', 'Author', 'Type', 'Tags', 'Status'],
    style: { head: ['cyan'] },
  });

  for (const entry of entries) {
    const statusColor =
      entry.status === 'active'
        ? chalk.green
        : entry.status === 'stale'
          ? chalk.yellow
          : chalk.gray;

    table.push([
      entry.title,
      entry.author,
      entry.type,
      entry.tags.slice(0, 3).join(', '),
      statusColor(entry.status),
    ]);
  }

  return `${chalk.bold(`Found ${entries.length} result${entries.length === 1 ? '' : 's'}:`)}\n${table.toString()}`;
}
