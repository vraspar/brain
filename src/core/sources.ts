import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SourceConfig, SourceRegistry } from '../types.js';

const SOURCES_FILE_NAME = 'sources.json';

export function getSourcesPath(): string {
  return path.join(os.homedir(), '.brain', SOURCES_FILE_NAME);
}

export function loadSources(): SourceRegistry {
  const sourcesPath = getSourcesPath();
  if (!fs.existsSync(sourcesPath)) {
    return { sources: {} };
  }
  const content = fs.readFileSync(sourcesPath, 'utf-8');
  return JSON.parse(content) as SourceRegistry;
}

export function saveSources(registry: SourceRegistry): void {
  const sourcesPath = getSourcesPath();
  const dir = path.dirname(sourcesPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(sourcesPath, JSON.stringify(registry, null, 2), 'utf-8');
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
