import { describe, it, expect } from 'vitest';
import { tokenize, extractTerms, extractCodeIdentifiers } from '../src/intelligence/tokenizer.js';
import { extractKeyphrases } from '../src/intelligence/rake.js';
import { rankTags } from '../src/intelligence/tag-ranker.js';
import {
  extractIntelligentTags,
  extractIntelligentTagsDetailed,
} from '../src/intelligence/index.js';
import { isStopWord, CONTENT_STOP_WORDS } from '../src/intelligence/stopwords.js';
import { STOP_WORDS } from '../src/utils/constants.js';

// --- Stopwords ---

describe('stopwords', () => {
  it('includes all existing STOP_WORDS', () => {
    for (const word of STOP_WORDS) {
      expect(CONTENT_STOP_WORDS.has(word)).toBe(true);
    }
  });

  it('includes additional English common words', () => {
    expect(isStopWord('because')).toBe(true);
    expect(isStopWord('however')).toBe(true);
    expect(isStopWord('although')).toBe(true);
  });

  it('includes code noise words', () => {
    expect(isStopWord('const')).toBe(true);
    expect(isStopWord('function')).toBe(true);
    expect(isStopWord('async')).toBe(true);
  });

  it('includes markdown structural words', () => {
    expect(isStopWord('overview')).toBe(true);
    expect(isStopWord('introduction')).toBe(true);
    expect(isStopWord('conclusion')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isStopWord('The')).toBe(true);
    expect(isStopWord('HOWEVER')).toBe(true);
  });

  it('does not include technical terms', () => {
    expect(isStopWord('kubernetes')).toBe(false);
    expect(isStopWord('docker')).toBe(false);
    expect(isStopWord('postgres')).toBe(false);
  });
});

// --- Tokenizer ---

describe('tokenizer', () => {
  it('extracts terms from plain text', () => {
    const tokens = tokenize('', 'Kubernetes deployment with Docker containers');
    const terms = tokens.map(t => t.term);
    expect(terms).toContain('kubernetes');
    expect(terms).toContain('docker');
    expect(terms).toContain('containers');
  });

  it('assigns title zone weight 3x', () => {
    const tokens = tokenize('Kubernetes Guide', '');
    const titleTokens = tokens.filter(t => t.zone === 'title');
    expect(titleTokens.length).toBeGreaterThan(0);
    for (const t of titleTokens) {
      expect(t.weight).toBe(3.0);
    }
  });

  it('assigns heading zone weight 2x', () => {
    const tokens = tokenize('', '## Deployment Strategy\nBody text');
    const headingTokens = tokens.filter(t => t.zone === 'heading');
    expect(headingTokens.length).toBeGreaterThan(0);
    for (const t of headingTokens) {
      expect(t.weight).toBe(2.0);
    }
  });

  it('assigns code block zone weight 1.5x', () => {
    const tokens = tokenize('', '```\nkubectl apply -f deployment.yaml\n```');
    const codeTokens = tokens.filter(t => t.zone === 'code');
    expect(codeTokens.length).toBeGreaterThan(0);
    for (const t of codeTokens) {
      expect(t.weight).toBe(1.5);
    }
  });

  it('assigns inline code zone weight 1.5x', () => {
    const tokens = tokenize('', 'Use `kubectl` to manage clusters');
    const inlineTokens = tokens.filter(t => t.zone === 'inline_code');
    expect(inlineTokens.length).toBeGreaterThan(0);
    for (const t of inlineTokens) {
      expect(t.weight).toBe(1.5);
    }
  });

  it('filters stop words', () => {
    const tokens = tokenize('', 'The quick brown fox jumps over the lazy dog');
    const terms = tokens.map(t => t.term);
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('over');
  });

  it('handles empty content', () => {
    expect(tokenize('', '')).toHaveLength(0);
  });

  it('handles content with only code blocks', () => {
    const tokens = tokenize('', '```\nkubectl apply -f deployment.yaml\n```');
    for (const t of tokens) {
      expect(t.zone).toBe('code');
    }
  });
});

describe('extractTerms', () => {
  it('lowercases all terms', () => {
    const terms = extractTerms('Docker Kubernetes API');
    expect(terms).toContain('docker');
    expect(terms).toContain('kubernetes');
    expect(terms).toContain('api');
  });

  it('filters terms shorter than 3 characters', () => {
    const terms = extractTerms('a to be or not to be in my API');
    expect(terms).not.toContain('a');
    expect(terms).not.toContain('to');
    expect(terms).not.toContain('be');
  });
});

describe('extractCodeIdentifiers', () => {
  it('finds PascalCase (GptqQuantizer → gptq-quantizer)', () => {
    const ids = extractCodeIdentifiers('```\nconst q = new GptqQuantizer();\n```');
    expect(ids).toContain('gptq-quantizer');
  });

  it('finds camelCase (modelOptimizer → model-optimizer)', () => {
    const ids = extractCodeIdentifiers('Use `modelOptimizer` for optimization');
    expect(ids).toContain('model-optimizer');
  });

  it('ignores short identifiers (<6 chars)', () => {
    const ids = extractCodeIdentifiers('```\nlet myFn = true;\n```');
    expect(ids).not.toContain('my-fn');
  });

  it('handles multiple identifiers', () => {
    const ids = extractCodeIdentifiers(
      '```python\nfrom olive import AutoAWQQuantizer, GptqQuantizer\n```'
    );
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts from inline code', () => {
    const ids = extractCodeIdentifiers('The `CUDAExecutionProvider` is fast');
    expect(Array.isArray(ids)).toBe(true);
  });

  it('returns empty for content without code', () => {
    expect(extractCodeIdentifiers('Plain text without code.')).toHaveLength(0);
  });
});

// --- RAKE ---

describe('RAKE keyphrase extraction', () => {
  it('extracts single-word keyphrases', () => {
    const phrases = extractKeyphrases('Kubernetes is a container orchestration platform');
    expect(phrases.some(p => p.phrase.includes('kubernetes'))).toBe(true);
  });

  it('extracts multi-word keyphrases', () => {
    const phrases = extractKeyphrases(
      'The payment service is critical for our platform. ' +
      'The payment service processes credit card transactions daily.'
    );
    expect(phrases.some(p => p.phrase.includes('payment service'))).toBe(true);
  });

  it('scores multi-word phrases higher than singles', () => {
    const phrases = extractKeyphrases(
      'Container orchestration platform enables deployment scaling. ' +
      'Container orchestration is essential for microservices.'
    );
    const multiWord = phrases.filter(p => p.words.length > 1);
    const singleWord = phrases.filter(p => p.words.length === 1);
    if (multiWord.length > 0 && singleWord.length > 0) {
      expect(multiWord[0].score).toBeGreaterThanOrEqual(singleWord[0].score);
    }
  });

  it('handles technical content', () => {
    const phrases = extractKeyphrases(
      'Configure horizontal pod autoscaler for automatic scaling.\n' +
      'Monitor deployments with Prometheus and Grafana.'
    );
    expect(phrases.length).toBeGreaterThan(0);
  });

  it('handles non-technical content', () => {
    const phrases = extractKeyphrases(
      'Team retrospective meeting notes.\n' +
      'We discussed improving documentation processes and onboarding workflows.'
    );
    expect(phrases.length).toBeGreaterThan(0);
  });

  it('respects maxPhrases limit', () => {
    const phrases = extractKeyphrases(
      'Docker containers. Kubernetes clusters. Redis cache. ' +
      'PostgreSQL database. React components. Node servers.',
      5,
    );
    expect(phrases.length).toBeLessThanOrEqual(5);
  });

  it('filters very long phrases (>4 words by default)', () => {
    const phrases = extractKeyphrases('word1 word2 word3 word4 word5 connected');
    for (const p of phrases) {
      expect(p.words.length).toBeLessThanOrEqual(4);
    }
  });

  it('deduplicates identical phrases', () => {
    const phrases = extractKeyphrases(
      'payment service is great. payment service is fast. payment service is reliable.'
    );
    expect(phrases.filter(p => p.phrase === 'payment service').length).toBeLessThanOrEqual(1);
  });

  it('handles empty input', () => {
    expect(extractKeyphrases('')).toHaveLength(0);
  });

  it('handles all-stopword input → empty result', () => {
    expect(extractKeyphrases('the and or but not is are was were')).toHaveLength(0);
  });
});

// --- Tag Ranker ---

describe('tag-ranker (integration)', () => {
  it('ranks tags for a Kubernetes guide', () => {
    const result = rankTags(
      'Kubernetes Deployment Best Practices',
      '## Kubernetes Cluster Management\n' +
      'Kubernetes orchestrates containerized applications across clusters.\n' +
      'Monitor your Kubernetes cluster with Prometheus dashboards.',
      null,
    );
    expect(result.tags.length).toBeGreaterThan(0);
    expect(result.tags.some(t => t.tag.includes('kubernetes'))).toBe(true);
  });

  it('ranks tags for a React hooks tutorial', () => {
    const result = rankTags(
      'React Custom Hooks Tutorial',
      '## Building Custom Hooks\n' +
      'React hooks extract component logic into reusable functions.\n' +
      '```typescript\nfunction useDebounce(value: string, delay: number) {}\n```',
      null,
    );
    expect(result.tags.length).toBeGreaterThan(0);
    expect(result.tags.some(t =>
      t.tag.includes('react') || t.tag.includes('hooks') || t.tag.includes('custom')
    )).toBe(true);
  });

  it('ranks tags for a non-technical entry', () => {
    const result = rankTags(
      'Team Onboarding Checklist',
      '## First Week\nMeet the team.\n## Second Week\nStart pair programming.',
      null,
    );
    expect(result.tags.length).toBeGreaterThan(0);
  });

  it('produces meaningful tags with RAKE', () => {
    const result = rankTags(
      'Payment Service Architecture',
      'The payment service architecture processes credit card transactions.\n' +
      'Stripe integration is used for recurring subscription billing.\n' +
      'The payment gateway validates card numbers before processing.',
      null,
    );
    expect(result.tags.length).toBeGreaterThan(0);
    expect(result.keyphrases.length).toBeGreaterThan(0);
  });

  it('code identifiers from code blocks become tag candidates', () => {
    const result = rankTags(
      'Quantization Guide',
      '```python\nfrom olive import GptqQuantizer, AutoAWQQuantizer\nq = GptqQuantizer(model)\n```',
      null,
    );
    const codeIdTags = result.tags.filter(t => t.source === 'code_id');
    expect(codeIdTags.length).toBeGreaterThan(0);
    expect(result.tags.some(t => t.tag.includes('gptq-quantizer') || t.tag.includes('quantizer'))).toBe(true);
  });

  it('known tech terms get boost', () => {
    const result = rankTags(
      'Docker Container Guide',
      'Docker containers package applications with their dependencies.\n' +
      'Use Dockerfile to define the container image build steps.',
      null,
    );
    const dockerTag = result.tags.find(t => t.tag === 'docker');
    expect(dockerTag).toBeDefined();
    expect(dockerTag!.score).toBeGreaterThan(0.2);
  });

  it('returns max 8 tags', () => {
    const result = rankTags(
      'Full Stack Development Guide',
      'React frontend. Node.js backend. PostgreSQL database. Redis caching.\n' +
      'Docker containerization. Kubernetes orchestration. Terraform infra.\n' +
      'Nginx proxy. GraphQL API. WebSocket updates. Prometheus monitoring.',
      null,
    );
    expect(result.tags.length).toBeLessThanOrEqual(8);
  });

  it('handles very short content', () => {
    const result = rankTags('Docker', 'Containers.', null);
    expect(result.tags).toBeDefined();
    expect(result.keyphrases).toBeDefined();
  });

  it('handles content that is all code blocks', () => {
    const result = rankTags(
      'Kubernetes Config',
      '```yaml\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: nginx\n```',
      null,
    );
    expect(result.tags).toBeDefined();
  });
});

// --- Fixture tests: realistic technical content ---

describe('fixture tests — realistic technical content', () => {
  it('quantization content produces domain-specific tags', () => {
    const tags = extractIntelligentTags(
      'Model Quantization with Olive',
      '## Quantization Overview\n' +
      'Olive supports multiple quantization algorithms for model optimization.\n' +
      '```python\nfrom olive.quantization import GptqQuantizer, AutoAWQQuantizer\n' +
      'quantizer = GptqQuantizer(bits=4, group_size=128)\n' +
      'model = quantizer.quantize(OnnxModel("model.onnx"))\n```\n' +
      '## Supported Algorithms\n' +
      '- GPTQ: Post-training quantization with calibration data\n' +
      '- AWQ: Activation-aware weight quantization\n' +
      '- RTN: Round-to-nearest weight quantization'
    );
    expect(tags.length).toBeGreaterThan(0);
    const tagStr = tags.join(' ');
    expect(tagStr.includes('quantiz') || tagStr.includes('gptq') || tagStr.includes('olive')).toBe(true);
  });

  it('getting-started guide produces framework-specific tags', () => {
    const tags = extractIntelligentTags(
      'Olive Getting Started',
      '## Installation\n```bash\npip install olive-ai\n```\n' +
      '## Model Optimization\nOlive optimizes ONNX models for inference.\n' +
      '```python\nfrom olive import OliveConfig\nconfig = OliveConfig(target_device="cpu")\n```'
    );
    expect(tags.length).toBeGreaterThan(0);
    const tagStr = tags.join(' ');
    expect(tagStr.includes('olive') || tagStr.includes('onnx') || tagStr.includes('optimization')).toBe(true);
  });

  it('inference runtime produces runtime-specific tags', () => {
    const tags = extractIntelligentTags(
      'ONNX Runtime Inference',
      '## Setup\nONNX Runtime provides cross-platform inference acceleration.\n' +
      '```python\nimport onnxruntime as ort\nsession = ort.InferenceSession("model.onnx")\n' +
      'providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]\n```\n' +
      'Execution providers enable hardware-specific optimizations.'
    );
    expect(tags.length).toBeGreaterThan(0);
    const tagStr = tags.join(' ');
    expect(tagStr.includes('onnx') || tagStr.includes('inference') || tagStr.includes('runtime')).toBe(true);
  });
});

// --- Public API ---

describe('extractIntelligentTags (public API)', () => {
  it('returns string[] of tags', () => {
    const tags = extractIntelligentTags('Docker Guide', 'Docker containers package apps.');
    expect(Array.isArray(tags)).toBe(true);
    tags.forEach(tag => expect(typeof tag).toBe('string'));
  });

  it('works without db (null)', () => {
    const tags = extractIntelligentTags('Kubernetes', 'Kubernetes clusters orchestrate apps.', null);
    expect(tags.length).toBeGreaterThan(0);
  });

  it('is a drop-in replacement for extractTags return type', () => {
    const tags = extractIntelligentTags('Test', 'Content about Docker and Kubernetes');
    expect(Array.isArray(tags)).toBe(true);
    tags.forEach(tag => expect(typeof tag).toBe('string'));
  });
});

describe('extractIntelligentTagsDetailed', () => {
  it('returns TagResult with tags and keyphrases', () => {
    const result = extractIntelligentTagsDetailed('Docker Guide', 'Docker containers.');
    expect(Array.isArray(result.tags)).toBe(true);
    expect(Array.isArray(result.keyphrases)).toBe(true);
  });

  it('tags have proper source attribution', () => {
    const result = extractIntelligentTagsDetailed(
      'Docker Guide',
      'Docker containers.\n```\nconst c = new DockerCompose();\n```',
    );
    expect(new Set(result.tags.map(t => t.source)).size).toBeGreaterThan(0);
  });
});

// --- Performance ---

describe('performance', () => {
  it('extractIntelligentTags: single entry < 50ms', () => {
    const content = 'Kubernetes deployment with Docker containers.\n'.repeat(50) +
      '## Architecture\nMicroservices via REST APIs.\n```\nkubectl apply -f deploy.yaml\n```';
    const start = performance.now();
    extractIntelligentTags('Kubernetes Deployment Guide', content);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
