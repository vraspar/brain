import { describe, expect, it } from 'vitest';
import { generateLinksFooter, stripLinksFooter } from '../src/core/obsidian.js';

describe('generateLinksFooter', () => {
  it('returns empty string for no links', () => {
    expect(generateLinksFooter([])).toBe('');
  });

  it('generates footer with wikilinks', () => {
    const footer = generateLinksFooter(['[[docker|Docker]]', '[[k8s|K8s]]']);
    expect(footer).toContain('<!-- brain:links');
    expect(footer).toContain('[[docker|Docker]]');
    expect(footer).toContain('[[k8s|K8s]]');
    expect(footer).toContain('**Related:**');
  });
});

describe('stripLinksFooter', () => {
  it('returns content unchanged when no footer', () => {
    const content = 'Hello world\n\nSome content.';
    expect(stripLinksFooter(content)).toBe(content);
  });

  it('strips footer below sentinel', () => {
    const content = 'Hello world\n\n---\n<!-- brain:links (auto-generated, do not edit) -->\n**Related:** [[a]], [[b]]';
    expect(stripLinksFooter(content)).toBe('Hello world');
  });

  it('preserves content above sentinel', () => {
    const content = 'Line 1\nLine 2\n\nParagraph\n\n---\n<!-- brain:links (auto-generated, do not edit) -->\n**Related:** [[a]]';
    const stripped = stripLinksFooter(content);
    expect(stripped).toContain('Line 1');
    expect(stripped).toContain('Paragraph');
    expect(stripped).not.toContain('brain:links');
  });
});
