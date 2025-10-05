import type { RedmineConfig } from './config.js';
import { RedmineApiClient } from './api.js';
import { syncIssue } from './sync-issue.js';

export interface SyncProjectOptions {
  status?: string;
  updatedSince?: string;
  dryRun?: boolean;
  outputDir?: string;
  concurrency?: number;
  pageSize?: number;
  onProgress?: (current: number, total: number) => void;
}

export interface SyncProjectResult {
  success: boolean;
  totalIssues: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{
    issueId: number;
    error: string;
  }>;
}

export async function syncProject(
  config: RedmineConfig,
  options: SyncProjectOptions = {}
): Promise<SyncProjectResult> {
  const client = new RedmineApiClient(config);
  const pageSize = options.pageSize || config.defaults.pageSize;

  const result: SyncProjectResult = {
    success: true,
    totalIssues: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    const issues = await client.getIssuesConcurrently(config.project.id, {
      status: options.status || config.defaults.status,
      pageSize,
      include: config.defaults.include,
      updatedSince: options.updatedSince,
      onProgress: options.onProgress,
    });

    result.totalIssues = issues.length;

    if (issues.length === 0) {
      return result;
    }

    const syncPromises = issues.map(async (issue) => {
      const syncResult = await syncIssue(issue.id, config, {
        dryRun: options.dryRun,
        outputDir: options.outputDir,
      });

      result.processed++;

      if (syncResult.success) {
        switch (syncResult.action) {
          case 'created':
            result.created++;
            break;
          case 'updated':
            result.updated++;
            break;
          case 'skipped':
            result.skipped++;
            break;
        }
      } else {
        result.failed++;
        result.errors.push({
          issueId: syncResult.issueId,
          error: syncResult.message,
        });
      }

      return syncResult;
    });

    await Promise.all(syncPromises);

    result.success = result.failed === 0;
    return result;
  } catch (error) {
    result.success = false;
    result.errors.push({
      issueId: 0,
      error: `Failed to fetch issues: ${error instanceof Error ? error.message : String(error)}`,
    });
    return result;
  }
}
