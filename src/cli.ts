#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig } from './config.js';
import { checkConnectivity } from './connectivity-check.js';
import { syncIssue, extractIssueIdFromUrl } from './sync-issue.js';
import { syncProject } from './sync-project.js';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const program = new Command();

program
  .name('redmine')
  .description('CLI to sync Redmine issues to local Markdown files')
  .version('0.1.17');

// Handle unknown commands with helpful suggestions
program.on('command:*', (operands) => {
  console.error(`❌ Unknown command: ${operands[0]}`);
  console.error('\nAvailable commands:');
  console.error('  init        - Initialize configuration in current directory');
  console.error('  check       - Check connectivity to Redmine API');
  console.error('  sync issue  - Sync a single issue');
  console.error('  sync project- Sync all issues in a project');
  console.error('\nUse "redmine --help" for more information.');
  process.exit(1);
});

program
  .option('-c, --config <path>', 'Path to configuration file', 'redmine.config.yaml')
  .option('-o, --output-dir <path>', 'Output directory for markdown files')
  .option('--dry-run', 'Show what would be done without making changes')
  .option('--json', 'Output results as JSON');

program
  .command('init')
  .description('Initialize configuration in current directory')
  .action(async () => {
    const configFileName = 'redmine.config.example.yaml';
    const configPath = join(process.cwd(), configFileName);
    const scriptFileName = 'redmine-sync-issue.sh';

    try {
      // Check if config already exists
      await fs.access(configPath);
      console.log(`⚠️  ${configFileName} already exists in current directory`);
      console.log('    If you want to recreate it, please delete the existing file first.');
      process.exit(0);
    } catch {
      // File doesn't exist, proceed with creation
    }

    // Prompt user for confirmation
    console.log('🚀 Initializing JVIT Redmine Context CLI in current directory');
    console.log('This will create:');
    console.log(`  - ${configFileName} (example configuration file)`);
    console.log(`  - scripts/${scriptFileName} (utility script)`);
    console.log('');

    try {
      // Create example config file with embedded content
      const exampleConfig = `# Example configuration for jvit-redmine-context-cli
# Copy this file to redmine.config.yaml and update with your settings

baseUrl: https://redmine.example.com
apiAccessToken: YOUR_API_TOKEN_HERE
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
`;

      try {
        await fs.writeFile(configPath, exampleConfig, 'utf8');
        console.log(`✅ Created ${configFileName}`);
      } catch (error) {
        console.error(
          `❌ Failed to create ${configFileName}:`,
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }

      // Create scripts directory
      const scriptsDir = join(process.cwd(), 'scripts');
      try {
        await fs.mkdir(scriptsDir, { recursive: true });
      } catch {
        // Directory might already exist
      }

      // Create redmine-sync-issue.sh script with embedded content
      const syncScript = `#!/bin/bash

# JVIT Redmine Context CLI - Issue Sync Script
# Usage: ./scripts/redmine-sync-issue.sh <id|url>

if [ \$# -eq 0 ]; then
    echo "Usage: \$0 <issue-id|issue-url>"
    echo ""
    echo "Examples:"
    echo "  \$0 12345"
    echo "  \$0 https://redmine.example.com/issues/12345"
    exit 1
fi

INPUT="\$1"

# Check if input is a URL
if [[ "\$INPUT" =~ ^https?:// ]]; then
    # Extract issue ID from URL
    ISSUE_ID=\$(echo "\$INPUT" | sed -n 's/.*\\/issues\\/\\([0-9]*\\).*/\\1/p')
    if [ -z "\$ISSUE_ID" ]; then
        echo "❌ Could not extract issue ID from URL: \$INPUT"
        exit 1
    fi
    echo "🔗 Detected URL, syncing issue ID: \$ISSUE_ID"
    redmine sync issue --url "\$INPUT"
else
    # Assume it's an issue ID
    if [[ ! "\$INPUT" =~ ^[0-9]+$ ]]; then
        echo "❌ Invalid issue ID: \$INPUT (must be a number)"
        exit 1
    fi
    echo "🔢 Detected issue ID: \$INPUT"
    redmine sync issue --id "\$INPUT"
fi
`;

      const targetScriptPath = join(scriptsDir, scriptFileName);

      try {
        await fs.writeFile(targetScriptPath, syncScript, 'utf8');

        // Make script executable
        await fs.chmod(targetScriptPath, 0o755);
        console.log(`✅ Created scripts/${scriptFileName} (executable)`);
      } catch (error) {
        console.error(
          `❌ Failed to create ${scriptFileName}:`,
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }

      console.log('');
      console.log('🎉 Initialization complete!');
      console.log('');
      console.log('Next steps:');
      console.log(`1. Copy ${configFileName} to redmine.config.yaml`);
      console.log('2. Update the configuration with your Redmine details');
      console.log('3. Run "redmine check" to verify connectivity');
      console.log(`4. Use "redmine sync issue --id <number>" or ./scripts/${scriptFileName}`);
    } catch (error) {
      console.error(
        '❌ Failed to initialize:',
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Check connectivity to Redmine API')
  .action(async (options, command) => {
    const globalOpts = command.parent?.opts() || {};
    const config = await loadConfig(globalOpts.config);

    const result = await checkConnectivity(config);

    if (globalOpts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.success) {
        console.log('✅', result.message);
        if (result.details?.project) {
          console.log(
            `   Project: ${result.details.project.name} (${result.details.project.identifier})`
          );
          console.log(`   Project ID: ${result.details.project.id}`);
        }
      } else {
        console.error('❌', result.message);
        process.exit(4);
      }
    }
  });

program
  .command('sync')
  .description('Sync Redmine issues to markdown files')
  .addCommand(
    new Command('issue')
      .description('Sync a single issue')
      .option('-i, --id <number>', 'Issue ID')
      .option('-u, --url <url>', 'Issue URL')
      .action(async (options, command) => {
        const globalOpts = command.parent?.parent?.opts() || {};
        const config = await loadConfig(globalOpts.config);

        let issueId: number;

        if (options.id) {
          issueId = parseInt(options.id, 10);
          if (isNaN(issueId)) {
            console.error('❌ Invalid issue ID');
            process.exit(2);
          }
        } else if (options.url) {
          const extractedId = extractIssueIdFromUrl(options.url);
          if (!extractedId) {
            console.error('❌ Could not extract issue ID from URL');
            process.exit(2);
          }
          issueId = extractedId;
        } else {
          console.error('❌ Either --id or --url must be provided');
          process.exit(2);
        }

        const result = await syncIssue(issueId, config, {
          dryRun: globalOpts.dryRun,
          outputDir: globalOpts.outputDir,
        });

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.success) {
            const icon = result.action === 'skipped' ? '⏭️' : '✅';
            console.log(`${icon} ${result.message}`);
            if (result.filePath) {
              console.log(`   File: ${result.filePath}`);
            }
          } else {
            console.error('❌', result.message);
            process.exit(4);
          }
        }
      })
  )
  .addCommand(
    new Command('project')
      .description('Sync all issues in a project')
      .option('-s, --status <status>', 'Filter by status (default: *)', '*')
      .option('--updated-since <date>', 'Only sync issues updated since YYYY-MM-DD')
      .option('--concurrency <number>', 'Number of concurrent requests')
      .option('--page-size <number>', 'Page size for API requests')
      .action(async (options, command) => {
        const globalOpts = command.parent?.parent?.opts() || {};
        const config = await loadConfig(globalOpts.config);

        const syncOptions: Parameters<typeof syncProject>[1] = {
          status: options.status,
          updatedSince: options.updatedSince,
          dryRun: globalOpts.dryRun,
          outputDir: globalOpts.outputDir,
          ...(options.concurrency && { concurrency: parseInt(options.concurrency, 10) }),
          ...(options.pageSize && { pageSize: parseInt(options.pageSize, 10) }),
          onProgress: globalOpts.json
            ? undefined
            : (current: number, total: number) => {
                process.stdout.write(`\rProgress: ${current}/${total} issues`);
              },
        };

        const result = await syncProject(config, syncOptions);

        if (!globalOpts.json) {
          process.stdout.write('\r'); // Clear progress line
        }

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.success) {
            console.log('✅ Sync completed successfully');
            console.log(`   Total issues: ${result.totalIssues}`);
            console.log(`   Created: ${result.created}`);
            console.log(`   Updated: ${result.updated}`);
            console.log(`   Skipped: ${result.skipped}`);
            if (result.failed > 0) {
              console.log(`   Failed: ${result.failed}`);
            }
          } else {
            console.log('❌ Sync completed with errors');
            console.log(`   Total issues: ${result.totalIssues}`);
            console.log(`   Processed: ${result.processed}`);
            console.log(`   Created: ${result.created}`);
            console.log(`   Updated: ${result.updated}`);
            console.log(`   Skipped: ${result.skipped}`);
            console.log(`   Failed: ${result.failed}`);

            if (result.errors.length > 0) {
              console.log('\nErrors:');
              result.errors.forEach((error) => {
                console.log(`   Issue ${error.issueId}: ${error.error}`);
              });
            }

            process.exit(5);
          }
        }
      })
  );

program.parse();
