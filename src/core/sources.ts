import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SourceConfig, SourceRegistry } from '../types.js';

const SOURCES_FILE_NAME = 'sources.yaml';

export function getSourcesPath(): string {
  return path.join(os.homedir(), '.brain', SOURCES_FILE_NAME);
}

function escapeYamlValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function serializeSourcesYaml(registry: SourceRegistry): string {
  const lines: string[] = ['sources:'];
  for (const [name, config] of Object.entries(registry.sources)) {
    lines.push(`  ${name}:`);
    lines.push(`    url: "${escapeYamlValue(config.url)}"`);
    if (config.path) {
      lines.push(`    path: "${escapeYamlValue(config.path)}"`);
    }
    if (config.exclude?.length) {
      lines.push('    exclude:');
      for (const ex of config.exclude) {
        lines.push(`      - "${escapeYamlValue(ex)}"`);
      }
    }
    lines.push(`    lastCommit: "${escapeYamlValue(config.lastCommit)}"`);
    lines.push(`    lastSync: "${escapeYamlValue(config.lastSync)}"`);
    lines.push(`    entryCount: ${config.entryCount}`);
    if (config.type) {
      lines.push(`    type: "${config.type}"`);
    }
    lines.push(`    sourceTag: ${config.sourceTag}`);
  }
  return lines.join('\n') + '\n';
}

function parseSourcesYaml(content: string): SourceRegistry {
  const registry: SourceRegistry = { sources: {} };
  const lines = content.split('\n');
  let currentSource: string | null = null;
  let currentConfig: Partial<SourceConfig> = {};
  let inExclude = false;
  let excludeList: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Top-level "sources:" key
    if (line.trim() === 'sources:') continue;

    // Detect source name (2 spaces + name + colon)
    const sourceNameMatch = line.match(/^ {2}(\w[\w-]*):$/);
    if (sourceNameMatch) {
      // Save previous source
      if (currentSource) {
        if (excludeList.length) currentConfig.exclude = excludeList;
        registry.sources[currentSource] = currentConfig as SourceConfig;
      }
      currentSource = sourceNameMatch[1];
      currentConfig = {};
      excludeList = [];
      inExclude = false;
      continue;
    }

    // Exclude array item (6 spaces + "- ")
    const excludeItemMatch = line.match(/^ {6}- (.+)$/);
    if (inExclude && excludeItemMatch) {
      excludeList.push(stripQuotes(excludeItemMatch[1].trim()));
      continue;
    }

    // Key-value pair (4 spaces + key: value)
    const kvMatch = line.match(/^ {4}(\w[\w]*): (.+)$/);
    if (kvMatch && currentSource) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2].trim();

      if (key === 'exclude') {
        inExclude = true;
        continue;
      }
      inExclude = false;

      const value = stripQuotes(rawValue);
      switch (key) {
        case 'url':
          currentConfig.url = value;
          break;
        case 'path':
          currentConfig.path = value;
          break;
        case 'lastCommit':
          currentConfig.lastCommit = value;
          break;
        case 'lastSync':
          currentConfig.lastSync = value;
          break;
        case 'entryCount':
          currentConfig.entryCount = Number.parseInt(value, 10);
          break;
        case 'type':
          currentConfig.type = value as SourceConfig['type'];
          break;
        case 'sourceTag':
          currentConfig.sourceTag = value === 'true';
          break;
      }
      continue;
    }

    // Handle "exclude:" on its own line
    const excludeKeyMatch = line.match(/^ {4}exclude:$/);
    if (excludeKeyMatch && currentSource) {
      inExclude = true;
      continue;
    }
  }

  // Save last source
  if (currentSource) {
    if (excludeList.length) currentConfig.exclude = excludeList;
    registry.sources[currentSource] = currentConfig as SourceConfig;
  }

  return registry;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

export function loadSources(): SourceRegistry {
  const sourcesPath = getSourcesPath();
  if (!fs.existsSync(sourcesPath)) {
    return { sources: {} };
  }
  const content = fs.readFileSync(sourcesPath, 'utf-8');
  return parseSourcesYaml(content);
}

export function saveSources(registry: SourceRegistry): void {
  const sourcesPath = getSourcesPath();
  const dir = path.dirname(sourcesPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const yaml = serializeSourcesYaml(registry);
  fs.writeFileSync(sourcesPath, yaml, 'utf-8');
}

export function getSource(name: string): SourceConfig | undefined {
  const registry = loadSources();
  return registry.sources[name];
}

export function upsertSource(name: string, config: SourceConfig): void {
  const registry = loadSources();
  registry.sources[name] = config;
  saveSources(registry);
}

export function removeSource(name: string): boolean {
  const registry = loadSources();
  if (!(name in registry.sources)) return false;
  delete registry.sources[name];
  saveSources(registry);
  return true;
}
