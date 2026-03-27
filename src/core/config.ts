import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrainConfig } from '../types.js';
import { sanitizeUrl } from '../utils/url.js';

const BRAIN_DIR_NAME = '.brain';
const CONFIG_FILE_NAME = 'config.yaml';

export function getBrainDir(): string {
  return path.join(os.homedir(), BRAIN_DIR_NAME);
}

export function ensureBrainDir(): void {
  const brainDir = getBrainDir();
  if (!fs.existsSync(brainDir)) {
    fs.mkdirSync(brainDir, { recursive: true });
  }
}

function getConfigPath(): string {
  return path.join(getBrainDir(), CONFIG_FILE_NAME);
}

/**
 * Escape a string value for safe YAML serialization.
 * Escapes backslashes and double quotes to prevent corruption.
 */
function escapeYamlValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Serialize a BrainConfig to simple YAML format.
 * Uses a minimal hand-rolled serializer to avoid extra dependencies.
 */
function serializeYaml(config: BrainConfig): string {
  const lines: string[] = [];
  if (config.remote) {
    lines.push(`remote: "${escapeYamlValue(config.remote)}"`);
  }
  lines.push(`local: "${escapeYamlValue(config.local)}"`);
  lines.push(`author: "${escapeYamlValue(config.author)}"`);
  if (config.hubName) {
    lines.push(`hubName: "${escapeYamlValue(config.hubName)}"`);
  }
  if (config.lastSync) {
    lines.push(`lastSync: "${escapeYamlValue(config.lastSync)}"`);
  }
  if (config.lastDigest) {
    lines.push(`lastDigest: "${escapeYamlValue(config.lastDigest)}"`);
  }
  if (config.obsidian) {
    lines.push(`obsidian: ${config.obsidian}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Parse a simple YAML config file into a BrainConfig.
 * Handles the limited key-value structure of our config format.
 */
function parseYaml(content: string): BrainConfig {
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();

    // Strip surrounding quotes and unescape
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    result[key] = value;
  }

  if (!result['local'] || !result['author']) {
    throw new Error(
      'Invalid brain config: missing required fields (local, author). ' +
      'Run "brain init" or "brain connect <url>" to set up.',
    );
  }

  return {
    remote: result['remote'],
    local: result['local'],
    author: result['author'],
    hubName: result['hubName'],
    lastSync: result['lastSync'],
    lastDigest: result['lastDigest'],
    obsidian: result['obsidian'] !== 'false',
  };
}

export function loadConfig(): BrainConfig {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    throw new Error(`Brain not configured. Run "brain init" or "brain connect <url>" to set up. Expected config at: ${configPath}`);
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  return parseYaml(content);
}

export function saveConfig(config: BrainConfig): void {
  ensureBrainDir();
  const configPath = getConfigPath();
  // Redact credentials from remote URL before persisting
  const safeConfig = config.remote
    ? { ...config, remote: sanitizeUrl(config.remote) }
    : config;
  const yaml = serializeYaml(safeConfig);
  fs.writeFileSync(configPath, yaml, 'utf-8');
}
