#!/usr/bin/env node

/**
 * Blog build script for brain.vraspar.com
 *
 * Converts markdown posts in website/blog-src/posts/ to HTML in website/blog/.
 * Uses gray-matter for frontmatter + marked for markdown-to-HTML.
 *
 * Usage: node scripts/build-blog.js
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POSTS_DIR = join(ROOT, 'website', 'blog-src', 'posts');
const OUTPUT_DIR = join(ROOT, 'website', 'blog');
const SITE_URL = 'https://brain.vraspar.com';

function loadPosts() {
  if (!existsSync(POSTS_DIR)) return [];
  return readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(file => {
      const raw = readFileSync(join(POSTS_DIR, file), 'utf8');
      const { data, content } = matter(raw);
      const slug = basename(file, '.md');
      const html = marked.parse(content);
      return { slug, html, ...data };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const HEAD = `  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='80' font-family='serif' fill='%238f7561'>b</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=Inter:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap" rel="stylesheet">`;

function renderPost(post) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(post.title)} \u2014 Brain CLI Blog</title>
  <meta name="description" content="${esc(post.summary || '')}">
  <meta property="og:title" content="${esc(post.title)}">
  <meta property="og:description" content="${esc(post.summary || '')}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${SITE_URL}/blog/${post.slug}/">
  <meta name="twitter:card" content="summary">
${HEAD}
  <link rel="stylesheet" href="../../style.css">
  <link rel="stylesheet" href="../blog.css">
</head>
<body>
  <nav class="blog-nav">
    <div class="container">
      <a href="/" class="blog-nav-brand">brain</a>
      <a href="/blog/">Blog</a>
    </div>
  </nav>
  <main class="blog-main">
    <article class="blog-post">
      <header class="blog-post-header">
        <h1>${esc(post.title)}</h1>
        <div class="blog-post-meta">
          <time datetime="${new Date(post.date).toISOString()}">${formatDate(post.date)}</time>
          ${post.author ? `<span class="blog-post-author">by ${esc(post.author)}</span>` : ''}
        </div>
      </header>
      <div class="blog-post-content">
        ${post.html}
      </div>
    </article>
    <div class="blog-post-footer">
      <a href="/blog/">&larr; All posts</a>
      <a href="https://github.com/vraspar/brain">GitHub &rarr;</a>
    </div>
  </main>
  <footer class="site-footer">
    <div class="container">
      <div>brain &middot; MIT License</div>
    </div>
  </footer>
</body>
</html>`;
}

function renderIndex(posts) {
  const list = posts.map(p => `
      <article class="blog-index-post">
        <a href="/blog/${p.slug}/">
          <h2>${esc(p.title)}</h2>
          <time datetime="${new Date(p.date).toISOString()}">${formatDate(p.date)}</time>
          ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
        </a>
      </article>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog \u2014 Brain CLI</title>
  <meta name="description" content="Blog posts about building Brain CLI.">
  <meta property="og:title" content="Blog \u2014 Brain CLI">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE_URL}/blog/">
  <meta name="twitter:card" content="summary">
${HEAD}
  <link rel="stylesheet" href="../style.css">
  <link rel="stylesheet" href="blog.css">
</head>
<body>
  <nav class="blog-nav">
    <div class="container">
      <a href="/" class="blog-nav-brand">brain</a>
      <a href="/blog/">Blog</a>
    </div>
  </nav>
  <main class="blog-main">
    <header class="blog-index-header">
      <h1>Blog</h1>
      <p>Notes on building Brain CLI.</p>
    </header>
    <div class="blog-index-list">
${list}
    </div>
  </main>
  <footer class="site-footer">
    <div class="container">
      <div>brain &middot; MIT License</div>
    </div>
  </footer>
</body>
</html>`;
}

const posts = loadPosts();
if (posts.length === 0) {
  console.log('No blog posts found in website/blog-src/posts/');
  process.exit(0);
}

for (const post of posts) {
  const postDir = join(OUTPUT_DIR, post.slug);
  mkdirSync(postDir, { recursive: true });
  writeFileSync(join(postDir, 'index.html'), renderPost(post));
  console.log(`  Built: blog/${post.slug}/`);
}

writeFileSync(join(OUTPUT_DIR, 'index.html'), renderIndex(posts));
console.log(`  Built: blog/index.html (${posts.length} post${posts.length === 1 ? '' : 's'})`);
