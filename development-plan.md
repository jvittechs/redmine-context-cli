# jvit-redmine-context-cli — Development Plan and Publishing Guide

## Purpose

A CLI to extract Redmine issues as context for agentic coding workflows. This document covers the technical stack, repository structure, coding standards, and end-to-end steps to build, test, and publish the package to npm.

## Technical Stack (Best Practices, 2025)

- Runtime: Node.js 22 LTS (or 20 LTS) — ESM-only package
- Language: TypeScript 5.6+
- CLI framework: commander 12+
- HTTP client: undici 6+
- Config parsing: yaml 2.5+ (single supported config file: `redmine.config.yaml`)
- Validation: zod 3+
- Markdown frontmatter: gray-matter 4+
- Concurrency & retry: p-limit 5+, p-retry 6+, p-queue 7+
- Slugify: slugify 1.6+ (or custom utility)
- Build: tsup 8+
- Dev runner: tsx 4+
- Linting: ESLint 9+ (flat config), @typescript-eslint 8+
- Formatting: Prettier 3+
- Testing: Vitest 2+, @vitest/coverage-v8
- Release mgmt (optional, recommended): Changesets 2+

Suggested `engines`:

```json
{
  "type": "module",
  "engines": { "node": ">=20.0.0" }
}
```

## Layout

```
    src/
      cli.ts                 # commander entry; subcommands
      config.ts              # config loader (YAML only)
      api.ts                 # undici client w/ retry & rate limit
      mappers.ts             # map Redmine JSON → frontmatter/body/comments
      slug.util.ts           # slug generator
      file.util.ts           # read/write markdown + anchors
      sync-issue.ts          # sync one issue (id|url) including comments
      sync-project.ts        # sync many issues
      connectivity-check.ts  # check command
    package.json
    tsconfig.json
    eslint.config.mjs
    README.md
```

## Package.json (core fields)

```jsonc
{
  "name": "jvit-redmine-context-cli",
  "version": "0.1.0",
  "description": "CLI to extract Redmine issues as context for agentic coding workflows",
  "type": "module",
  "bin": { "redmine": "dist/cli.js" },
  "exports": {
    ".": "./dist/cli.js",
  },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "license": "MIT",
  "author": "Your Name <you@example.com>",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/your-org/jvit-redmine-context-cli.git",
  },
  "keywords": ["redmine", "cli", "markdown", "issues", "context", "agentic", "coding"],
  "scripts": {
    "build": "tsup src/cli.ts --dts --format esm --target node22 --out-dir dist --sourcemap",
    "dev": "tsx src/cli.ts --help",
    "lint": "eslint .",
    "test": "vitest run",
    "release": "changeset version && pnpm install --no-frozen-lockfile && git commit -am \"chore: version\" && git push && npm publish --access public",
  },
  "dependencies": {
    "commander": "^12.1.0",
    "undici": "^6.19.5",
    "zod": "^3.23.8",
    "yaml": "^2.5.0",
    "gray-matter": "^4.0.3",
    "p-limit": "^5.0.0",
    "p-retry": "^6.2.0",
    "p-queue": "^7.4.1",
    "slugify": "^1.6.6",
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "tsup": "^8.1.0",
    "tsx": "^4.19.2",
    "vitest": "^2.1.4",
    "@vitest/coverage-v8": "^2.1.4",
    "eslint": "^9.9.0",
    "@typescript-eslint/eslint-plugin": "^8.6.0",
    "@typescript-eslint/parser": "^8.6.0",
    "prettier": "^3.3.3",
    "@changesets/cli": "^2.27.7",
  },
}
```

## Config File — Single Source (YAML)

Only support a single file at repo root: `redmine.config.yaml`. The API token is stored in this file.

Example:

```yaml
baseUrl: https://redmine.example.com
apiAccessToken: YOUR_API_TOKEN
project:
  id: 123
  identifier: my-project
outputDir: .jai1/redmine
defaults:
  include: [journals, relations, attachments]
  status: '*'
  pageSize: 100
  concurrency: 4
  retry:
    retries: 3
    baseMs: 300
filename:
  pattern: '{issueId}-{slug}.md'
  slug:
    maxLength: 80
    dedupe: true
    lowercase: true
  renameOnTitleChange: false
comments:
  anchors:
    start: '<!-- redmine:comments:start -->'
    end: '<!-- redmine:comments:end -->'
  trackBy: journalId
```

## CLI Design

- Command: `redmine`
- Subcommands:
  - `check`
  - `sync issue --id <id>` or `--url <.../issues/ID>` (always fetches comments and updates `lastJournalId`)
  - `sync project [--status *] [--updated-since YYYY-MM-DD]`
- Global flags: `--config`, `--outputDir`, `--dry-run`, `--json`, `--concurrency`, `--pageSize`
- Exit codes: 0 OK, 2 validation, 4 not found, 5 system/network

## Coding Standards

- ESM-only, TypeScript strict mode
- Functional core, minimal side-effects; idempotent file writes
- Small modules, explicit types for public functions
- Error codes per conventions (VALIDATION*\*, RESOURCE*\_, SYSTEM\_\_, BUSINESS\_\*)
- Tests:
  - Unit: slug, config loader, frontmatter IO, mappers
  - Integration: API wrapper (mock), pagination, retries

## Building

```bash
pnpm i
pnpm build
node dist/cli.js --help
```

## Local Development

```bash
# Run directly with tsx
pnpm dev
# Or run a subcommand
tsx src/cli.ts check --config ./redmine.config.yaml
```

## NPM Publishing Steps

1. Create repository (GitHub) and push code
2. Ensure `package.json` has correct fields (`name`, `version`, `bin`, `files`, `type`)
3. Log in to npm:

```bash
npm login
```

4. Enable 2FA for publish on npm (recommended)
5. Build and publish:

```bash
pnpm build
npm publish --access public
```

6. Verify install:

```bash
npm info jvit-redmine-context-cli
pnpm dlx jvit-redmine-context-cli --help # if you publish with executable installer
```

### Provenance (optional, recommended)

- Use npm provenance with GitHub Actions for trusted builds
- Add `--provenance` flag (requires setup):

```bash
npm publish --provenance --access public
```

## GitHub Actions — Release Workflow (example)

```yaml
name: Release
on:
  push:
    tags:
      - 'v*.*.*'
jobs:
  build-and-publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # for npm provenance
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm i --frozen-lockfile
      - run: pnpm build
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Versioning Strategy

- Semantic Versioning (SemVer)
- Optionally use Changesets for PR-based version bumps and changelog generation
- Tag releases `vX.Y.Z`; CI publishes automatically

## Security & Compliance

- Token lives in `redmine.config.yaml`; do not commit if repo policy requires secrecy (or store encrypted/separate private repo)
- Do not log tokens; redact headers
- Respect `.gitignore` for cache/logs in consumer projects
- Supply a clear `README.md` with configuration and examples

## Milestones

1. MVP commands (`check`, `sync issue`, `sync project`)
2. Idempotent file IO with frontmatter anchors
3. Pagination + concurrency + retry
4. Release to npm with CI
5. Extended features (attachments, custom fields, ETag caching)
