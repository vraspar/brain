#!/usr/bin/env node

/**
 * Docs consistency check: verifies all commands are documented and registered.
 *
 * Checks:
 * 1. Every .ts file in src/commands/ has a matching entry in docs/commands.md
 * 2. Every command file is imported and registered in src/index.ts
 * 3. README.md features section mentions all commands
 *
 * Exit code 0 = all consistent, 1 = inconsistencies found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const commandFiles = fs.readdirSync(path.join(root, 'src', 'commands'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replace('.ts', ''));

const indexContent = fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf-8');
const docsPath = path.join(root, 'docs', 'commands.md');
const readmePath = path.join(root, 'README.md');

let failures = 0;

function check(label, condition, detail) {
  if (!condition) {
    console.error(`✗ ${label}: ${detail}`);
    failures++;
  } else {
    console.log(`✓ ${label}`);
  }
}

// Check 1: Every command file is registered in index.ts
for (const cmd of commandFiles) {
  const importPattern = `./commands/${cmd}.js`;
  check(
    `index.ts imports ${cmd}`,
    indexContent.includes(importPattern),
    `Missing import for "${importPattern}" in src/index.ts`,
  );
}

// Check 2: docs/commands.md exists and mentions each command
if (fs.existsSync(docsPath)) {
  const docsContent = fs.readFileSync(docsPath, 'utf-8').toLowerCase();
  for (const cmd of commandFiles) {
    check(
      `docs/commands.md documents "${cmd}"`,
      docsContent.includes(`brain ${cmd}`) || docsContent.includes(`## ${cmd}`) || docsContent.includes(`\`${cmd}\``),
      `Command "${cmd}" not found in docs/commands.md`,
    );
  }
} else {
  check('docs/commands.md exists', false, 'File not found');
}

// Check 3: README mentions all commands
if (fs.existsSync(readmePath)) {
  const readmeContent = fs.readFileSync(readmePath, 'utf-8').toLowerCase();
  for (const cmd of commandFiles) {
    check(
      `README.md mentions "${cmd}"`,
      readmeContent.includes(`brain ${cmd}`) || readmeContent.includes(`\`${cmd}\``),
      `Command "${cmd}" not found in README.md`,
    );
  }
} else {
  check('README.md exists', false, 'File not found');
}

// Summary
console.log('');
if (failures > 0) {
  console.error(`${failures} inconsistency(ies) found.`);
  process.exit(1);
} else {
  console.log('All docs consistent.');
}
