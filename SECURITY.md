# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in Brain CLI, please report it privately. Do not open a public GitHub issue.

**Email:** vrajang@outlook.com

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what an attacker could do)
- Suggested fix, if you have one

## Response timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 1 week
- **Fix or mitigation**: depends on severity, targeting 2 weeks for critical issues

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Scope

The following are in scope:
- CLI command injection or argument injection
- Git credential exposure (URLs with embedded tokens)
- FTS5 query injection
- Path traversal in file operations
- MCP server vulnerabilities

The following are out of scope:
- Vulnerabilities in the git repository hosting service (GitHub, GitLab, etc.)
- Social engineering
- Denial of service against the local SQLite database
