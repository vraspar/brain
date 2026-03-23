import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrainConfig } from '../types.js';

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
 * Serialize a BrainConfig to simple YAML format.
 * Uses a minimal hand-rolled serializer to avoid extra dependencies.
 */
function serializeYaml(config: BrainConfig): string {
  const lines: string[] = [];
  lines.push(`remote: "${config.remote}"`);
  lines.push(`local: "${config.local}"`);
  lines.push(`author: "${config.author}"`);
  if (config.lastSync) {
    lines.push(`lastSync: "${config.lastSync}"`);
  }
  if (config.lastDigest) {
    lines.push(`lastDigest: "${config.lastDigest}"`);
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

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  if (!result['remote'] || !result['local'] || !result['author']) {
    throw new Error(
      'Invalid brain config: missing required fields (remote, local, author). Run "brain join <url>" to set up.',
    );
  }

  return {
    remote: result['remote'],
    local: result['local'],
    author: result['author'],
    lastSync: result['lastSync'],
    lastDigest: result['lastDigest'],
  };
}

export function loadConfig(): BrainConfig {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    throw new Error(`Brain not configured. Run "brain join <url>" to connect to a team brain. Expected config at: ${configPath}`);
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  return parseYaml(content);
}

export function saveConfig(config: BrainConfig): void {
  ensureBrainDir();
  const configPath = getConfigPath();
  const yaml = serializeYaml(config);
  fs.writeFileSync(configPath, yaml, 'utf-8');
}
