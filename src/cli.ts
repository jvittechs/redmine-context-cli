#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig } from './config.js';
import { checkConnectivity } from './connectivity-check.js';
import { syncIssue, extractIssueIdFromUrl } from './sync-issue.js';
import { syncProject } from './sync-project.js';

const program = new Command();

program
  .name('redmine')
  .description('CLI to sync Redmine issues to local Markdown files')
  .version('0.1.0');

program
  .option('-c, --config <path>', 'Path to configuration file', 'redmine.config.yaml')
  .option('-o, --output-dir <path>', 'Output directory for markdown files')
  .option('--dry-run', 'Show what would be done without making changes')
  .option('--json', 'Output results as JSON')
  .hook('preAction', async (thisCommand) => {
    try {
      const configPath = thisCommand.opts().config;
      await loadConfig(configPath);
    } catch (error) {
      console.error(
        `Configuration error: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(2);
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
            if (result.filename) {
              console.log(`   File: ${result.filename}`);
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
