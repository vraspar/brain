import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from '../src/utils/url.js';

describe('sanitizeUrl', () => {
  it('strips user:token credentials from HTTPS URL', () => {
    expect(sanitizeUrl('https://user:ghp_abc123@github.com/org/repo.git'))
      .toBe('https://github.com/org/repo.git');
  });

  it('strips username-only credentials from HTTPS URL', () => {
    expect(sanitizeUrl('https://user@github.com/org/repo.git'))
      .toBe('https://github.com/org/repo.git');
  });

  it('passes through clean HTTPS URLs unchanged', () => {
    expect(sanitizeUrl('https://github.com/org/repo.git'))
      .toBe('https://github.com/org/repo.git');
  });

  it('passes through SSH URLs unchanged', () => {
    expect(sanitizeUrl('git@github.com:org/repo.git'))
      .toBe('git@github.com:org/repo.git');
  });

  it('handles URLs with port numbers', () => {
    expect(sanitizeUrl('https://user:token@gitlab.example.com:8443/repo.git'))
      .toBe('https://gitlab.example.com:8443/repo.git');
  });

  it('handles empty string', () => {
    expect(sanitizeUrl('')).toBe('');
  });

  it('passes through non-URL strings unchanged', () => {
    expect(sanitizeUrl('not-a-url')).toBe('not-a-url');
  });
});
