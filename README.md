# jvit-redmine-cli

A project-based CLI for syncing Redmine issues to local Markdown files.

## Features

- Sync individual issues or entire projects
- Incremental updates with change detection
- Comment synchronization with tracking
- Configurable filename patterns and slug generation
- Concurrent processing for large projects
- Retry logic and rate limiting
- YAML configuration with validation

## Installation

```bash
npm install -g jvit-redmine-cli
# or
pnpm add -g jvit-redmine-cli
```

## Configuration

Create a `redmine.config.yaml` file in your project root:

```yaml
baseUrl: https://redmine.example.com
apiAccessToken: YOUR_API_TOKEN
project:
  id: 123
  identifier: my-project
outputDir: .redmine
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

### Configuration Options

- `baseUrl`: Your Redmine instance URL
- `apiAccessToken`: Redmine API access token
- `project.id`: Project ID (numeric)
- `project.identifier`: Project identifier (string)
- `outputDir`: Directory to store markdown files (default: `.redmine`)
- `defaults.include`: What to include (journals, relations, attachments)
- `defaults.status`: Filter by status (`*` for all)
- `defaults.pageSize`: API page size (1-100)
- `defaults.concurrency`: Concurrent requests (1-10)
- `filename.pattern`: Filename pattern with `{issueId}` and `{slug}` placeholders
- `filename.slug`: Slug generation options
- `comments.anchors`: Comment section markers
- `comments.trackBy`: How to track new comments (`journalId` or `createdOn`)

## Usage

### Check Connectivity

```bash
redmine check
```

### Sync Single Issue

```bash
# By ID
redmine sync issue --id 123

# By URL
redmine sync issue --url https://redmine.example.com/issues/123

# Dry run
redmine sync issue --id 123 --dry-run
```

### Sync Project

```bash
# Sync all issues
redmine sync project

# Filter by status
redmine sync project --status "open"

# Sync issues updated since date
redmine sync project --updated-since 2023-01-01

# Custom concurrency and page size
redmine sync project --concurrency 8 --page-size 50

# Dry run
redmine sync project --dry-run
```

### Global Options

- `-c, --config <path>`: Path to configuration file (default: `redmine.config.yaml`)
- `-o, --output-dir <path>`: Output directory for markdown files
- `--dry-run`: Show what would be done without making changes
- `--json`: Output results as JSON

## Output Format

Issues are saved as Markdown files with frontmatter:

```markdown
---
id: 123
subject: 'Example Issue'
status: 'Open'
priority: 'Normal'
author: 'John Doe'
assigned_to: 'Jane Smith'
created_on: '2023-01-01T10:00:00Z'
updated_on: '2023-01-02T15:30:00Z'
project: 'My Project'
tracker: 'Bug'
lastJournalId: 456
---

# Issue Description

This is the issue description...

<!-- redmine:comments:start -->

## John Doe - 2023-01-02 15:30

This is a comment on the issue.

---

## Jane Smith - 2023-01-03 09:15

Another comment with changes.

**Changes:**

- status: Open → In Progress
- assigned_to: John Doe → Jane Smith

---

<!-- redmine:comments:end -->
```

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint
```

## API Exit Codes

- `0`: Success
- `2`: Validation error (configuration, arguments)
- `4`: Resource not found (issue, project)
- `5`: System/network error

## License

MIT
# redmine-context-cli
