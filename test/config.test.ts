import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrainDir, loadConfig, saveConfig } from '../src/core/config.js';
import type { BrainConfig } from '../src/types.js';

// Mock the home directory to use a temp dir for testing
let tempDir: string;
let originalHomedir: () => string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-test-'));
  originalHomedir = os.homedir;
  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('getBrainDir', () => {
  it('returns path under home directory', () => {
    const brainDir = getBrainDir();
    expect(brainDir).toBe(path.join(tempDir, '.brain'));
  });
});

describe('saveConfig and loadConfig', () => {
  const testConfig: BrainConfig = {
    remote: 'https://github.com/team/brain-repo.git',
    local: '/home/user/.brain/repo',
    author: 'alice',
  };

  it('saves and loads a config roundtrip', () => {
    saveConfig(testConfig);
    const loaded = loadConfig();
    expect(loaded.remote).toBe(testConfig.remote);
    expect(loaded.local).toBe(testConfig.local);
    expect(loaded.author).toBe(testConfig.author);
  });

  it('preserves optional fields', () => {
    const fullConfig: BrainConfig = {
      ...testConfig,
      lastSync: '2026-03-21T00:00:00Z',
      lastDigest: '2026-03-20T00:00:00Z',
    };
    saveConfig(fullConfig);
    const loaded = loadConfig();
    expect(loaded.lastSync).toBe(fullConfig.lastSync);
    expect(loaded.lastDigest).toBe(fullConfig.lastDigest);
  });

  it('throws when config file does not exist', () => {
    expect(() => loadConfig()).toThrow('Brain not configured');
  });

  it('throws when config is missing required fields', () => {
    const brainDir = path.join(tempDir, '.brain');
    fs.mkdirSync(brainDir, { recursive: true });
    fs.writeFileSync(path.join(brainDir, 'config.yaml'), 'remote: "x"\n', 'utf-8');
    expect(() => loadConfig()).toThrow('missing required fields');
  });

  it('creates .brain directory if it does not exist', () => {
    const brainDir = path.join(tempDir, '.brain');
    expect(fs.existsSync(brainDir)).toBe(false);
    saveConfig(testConfig);
    expect(fs.existsSync(brainDir)).toBe(true);
  });
});
