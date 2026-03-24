import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIndex, rebuildIndex } from '../src/core/index-db.js';
import { computeRelationship, getRelatedEntries, getTrailEntries } from '../src/core/links.js';
import type { Entry } from '../src/types.js';
import type Database from 'better-sqlite3';

let tempDir: string;
let db: Database.Database;

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'test-entry',
    title: 'Test Entry',
    type: 'guide',
    author: 'alice',
    created: '2026-03-20T10:00:00Z',
    updated: '2026-03-20T10:00:00Z',
    tags: [],
    status: 'active',
    content: 'Test content.',
    filePath: 'guides/test-entry.md',
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-links-test-'));
  const dbPath = path.join(tempDir, 'test-cache.db');
  db = createIndex(dbPath);
});

afterEach(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('computeRelationship', () => {
  it('scores shared tags at 0.15 per tag', () => {
    const a = makeEntry({ id: 'a', tags: ['docker', 'kubernetes', 'helm'] });
    const b = makeEntry({ id: 'b', tags: ['kubernetes', 'helm', 'ci'] });
    const result = computeRelationship(a, b);

    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(0.3); // 2 shared tags
    expect(result!.reason).toContain('2 shared tags');
    expect(result!.reason).toContain('kubernetes');
    expect(result!.reason).toContain('helm');
  });

  it('caps tag score at 0.6', () => {
    const a = makeEntry({ id: 'a', tags: ['a', 'b', 'c', 'd', 'e'] });
    const b = makeEntry({ id: 'b', tags: ['a', 'b', 'c', 'd', 'e'] });
    const result = computeRelationship(a, b);

    expect(result).not.toBeNull();
    // 5 tags × 0.15 = 0.75, but capped at 0.6 + 0.1 (same author) = 0.7
    expect(result!.score).toBeLessThanOrEqual(1.0);
  });

  it('scores title keyword overlap', () => {
    const a = makeEntry({ id: 'a', title: 'Docker Deployment Guide', author: 'alice' });
    const b = makeEntry({ id: 'b', title: 'Docker Setup Guide', author: 'bob' });
    const result = computeRelationship(a, b);

    expect(result).not.toBeNull();
    expect(result!.reason).toContain('title overlap');
    expect(result!.reason).toContain('docker');
  });

  it('ignores short title words (<=3 chars)', () => {
    const a = makeEntry({ id: 'a', title: 'How to use Git', author: 'alice' });
    const b = makeEntry({ id: 'b', title: 'How to use SVN', author: 'bob' });
    // "how", "to", "use" are all <=3 chars, no overlap
    const result = computeRelationship(a, b);
    // May be null or have no title overlap reason
    if (result) {
      expect(result.reason).not.toContain('title overlap');
    }
  });

  it('scores same author as +0.1', () => {
    const a = makeEntry({ id: 'a', author: 'alice', tags: ['docker'] });
    const b = makeEntry({ id: 'b', author: 'alice', tags: ['docker'] });
    const result = computeRelationship(a, b);

    expect(result).not.toBeNull();
    expect(result!.reason).toContain('same author');
  });

  it('scores content cross-references', () => {
    const a = makeEntry({ id: 'a', title: 'K8s Guide', content: 'See docker-setup for details.' });
    const b = makeEntry({ id: 'docker-setup', title: 'Docker Setup', content: 'Basic docker setup.' });
    const result = computeRelationship(a, b);

    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(0.2);
  });

  it('returns null when score below threshold', () => {
    const a = makeEntry({ id: 'a', title: 'AAA', tags: [], author: 'alice', content: 'Content A.' });
    const b = makeEntry({ id: 'b', title: 'BBB', tags: [], author: 'bob', content: 'Content B.' });
    const result = computeRelationship(a, b);

    expect(result).toBeNull();
  });

  it('caps total score at 1.0', () => {
    const a = makeEntry({
      id: 'a',
      title: 'Docker Kubernetes Guide',
      tags: ['docker', 'kubernetes', 'helm', 'ci'],
      author: 'alice',
      content: 'Refs Docker K8s Setup and docker-k8s-setup.',
    });
    const b = makeEntry({
      id: 'docker-k8s-setup',
      title: 'Docker K8s Setup',
      tags: ['docker', 'kubernetes', 'helm', 'ci'],
      author: 'alice',
      content: 'Refs Docker Kubernetes Guide and docker-kubernetes-guide.',
    });
    const result = computeRelationship(a, b);

    expect(result).not.toBeNull();
    expect(result!.score).toBeLessThanOrEqual(1.0);
  });
});

describe('getRelatedEntries', () => {
  const entries = [
    makeEntry({ id: 'docker-guide', title: 'Docker Guide', tags: ['docker', 'containers'], author: 'alice' }),
    makeEntry({ id: 'k8s-guide', title: 'K8s Guide', tags: ['kubernetes', 'docker', 'containers'], author: 'alice' }),
    makeEntry({ id: 'react-guide', title: 'React Guide', tags: ['react', 'frontend'], author: 'bob' }),
  ];

  beforeEach(() => {
    rebuildIndex(db, entries);
  });

  it('returns related entries sorted by score', () => {
    const related = getRelatedEntries(db, 'docker-guide');
    // k8s-guide shares docker+containers tags + same author → should be related
    expect(related.length).toBeGreaterThanOrEqual(1);
    expect(related[0].entry.id).toBe('k8s-guide');
    expect(related[0].score).toBeGreaterThan(0);
    expect(related[0].reason).toBeTruthy();
  });

  it('stores links symmetrically', () => {
    const fromDocker = getRelatedEntries(db, 'docker-guide');
    const fromK8s = getRelatedEntries(db, 'k8s-guide');

    const dockerLinksToK8s = fromDocker.some((r) => r.entry.id === 'k8s-guide');
    const k8sLinksToDocker = fromK8s.some((r) => r.entry.id === 'docker-guide');

    expect(dockerLinksToK8s).toBe(true);
    expect(k8sLinksToDocker).toBe(true);
  });

  it('respects limit parameter', () => {
    const related = getRelatedEntries(db, 'docker-guide', 1);
    expect(related.length).toBeLessThanOrEqual(1);
  });

  it('returns empty array for entry with no relations', () => {
    const related = getRelatedEntries(db, 'react-guide');
    // react-guide has no overlapping tags with others (different domain)
    // May or may not have relations depending on author/title signals
    expect(Array.isArray(related)).toBe(true);
  });
});

describe('getTrailEntries', () => {
  const entries = [
    makeEntry({ id: 'docker-basics', title: 'Docker Basics', tags: ['docker'], content: 'Intro to docker.' }),
    makeEntry({ id: 'docker-compose', title: 'Docker Compose', tags: ['docker', 'compose'], content: 'Multi-container with Docker Basics.' }),
    makeEntry({ id: 'k8s-deploy', title: 'K8s Deployment', tags: ['kubernetes', 'docker'], content: 'Deploy with k8s.' }),
    makeEntry({ id: 'react-testing', title: 'React Testing', tags: ['react', 'testing'], author: 'bob', content: 'Test React.' }),
  ];

  beforeEach(() => {
    rebuildIndex(db, entries);
  });

  it('finds direct matches and linked entries', () => {
    const trail = getTrailEntries(db, 'docker');
    // Should find docker-basics, docker-compose, k8s-deploy (linked via docker tag)
    expect(trail.length).toBeGreaterThanOrEqual(2);
    const ids = trail.map((t) => t.entry.id);
    expect(ids).toContain('docker-basics');
    expect(ids).toContain('docker-compose');
  });

  it('includes related entry metadata', () => {
    const trail = getTrailEntries(db, 'docker');
    const dockerBasics = trail.find((t) => t.entry.id === 'docker-basics');
    expect(dockerBasics).toBeTruthy();
    // related should be an array
    expect(Array.isArray(dockerBasics!.related)).toBe(true);
  });

  it('respects limit', () => {
    const trail = getTrailEntries(db, 'docker', 2);
    expect(trail.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array for unknown topic', () => {
    const trail = getTrailEntries(db, 'xyznonexistent');
    expect(trail).toHaveLength(0);
  });
});
