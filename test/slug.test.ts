import { describe, expect, it } from 'vitest';
import { slugFromPath, toSlug } from '../src/utils/slug.js';

describe('toSlug', () => {
  it('converts a simple title to lowercase hyphenated slug', () => {
    expect(toSlug('My Cool Guide')).toBe('my-cool-guide');
  });

  it('removes special characters', () => {
    expect(toSlug('Hello, World! (2026)')).toBe('hello-world-2026');
  });

  it('collapses multiple spaces into single hyphens', () => {
    expect(toSlug('  Hello   World  ')).toBe('hello-world');
  });

  it('collapses multiple hyphens', () => {
    expect(toSlug('hello---world')).toBe('hello-world');
  });

  it('handles empty string', () => {
    expect(toSlug('')).toBe('');
  });

  it('handles string with only special characters', () => {
    expect(toSlug('!!@@##')).toBe('');
  });

  it('preserves numbers', () => {
    expect(toSlug('Guide v2.0')).toBe('guide-v20');
  });

  it('handles already-slugified input', () => {
    expect(toSlug('already-a-slug')).toBe('already-a-slug');
  });
});

describe('slugFromPath', () => {
  it('extracts slug from a simple filename', () => {
    expect(slugFromPath('my-guide.md')).toBe('my-guide');
  });

  it('extracts slug from a path with directories', () => {
    expect(slugFromPath('guides/setup/my-cool-guide.md')).toBe('my-cool-guide');
  });

  it('handles filename without .md extension', () => {
    expect(slugFromPath('notes/readme')).toBe('readme');
  });

  it('is case-insensitive for .md extension', () => {
    expect(slugFromPath('guide.MD')).toBe('guide');
  });
});
