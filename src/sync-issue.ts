import { resolve } from 'node:path';
import type { RedmineConfig } from './config.js';
import { RedmineApiClient } from './api.js';
import {
  mapIssueToFrontmatter,
  mapIssueToContent,
  mapJournalsToComments,
  extractNewJournals,
  shouldUpdateIssue,
  shouldUpdateComments,
} from './mappers.js';
import { generateFilename } from './slug.util.js';
import {
  readMarkdownFile,
  writeMarkdownFile,
  extractIssueIdFromFrontmatter,
  extractLastJournalId,
} from './file.util.js';

export interface SyncIssueOptions {
  dryRun?: boolean;
  outputDir?: string;
}

export interface SyncIssueResult {
  success: boolean;
  issueId: number;
  filename: string;
  action: 'created' | 'updated' | 'skipped';
  message: string;
  changes?: {
    content?: boolean;
    comments?: boolean;
    frontmatter?: boolean;
  };
}

export async function syncIssue(
  issueId: number,
  config: RedmineConfig,
  options: SyncIssueOptions = {}
): Promise<SyncIssueResult> {
  const client = new RedmineApiClient(config);
  const outputDir = options.outputDir || config.outputDir;

  try {
    const include = config.defaults.include;
    const response = await client.getIssue(issueId, include);
    const issue = response.issue;

    const filename = generateFilename(issue.id, issue.subject, config.filename);
    const filePath = resolve(outputDir, filename);

    const existingFile = await readMarkdownFile(filePath);
    const existingIssueId = extractIssueIdFromFrontmatter(existingFile.frontmatter);
    const existingLastJournalId = extractLastJournalId(existingFile.frontmatter);

    if (existingIssueId && existingIssueId !== issue.id) {
      return {
        success: false,
        issueId: issue.id,
        filename,
        action: 'skipped',
        message: `File ${filename} contains issue ${existingIssueId}, not ${issue.id}`,
      };
    }

    const needsUpdate = shouldUpdateIssue(issue, existingFile.frontmatter);
    const needsCommentsUpdate = shouldUpdateComments(
      issue.journals || [],
      existingFile.frontmatter
    );

    if (!needsUpdate && !needsCommentsUpdate) {
      return {
        success: true,
        issueId: issue.id,
        filename,
        action: 'skipped',
        message: `Issue ${issueId} is already up to date`,
      };
    }

    const frontmatter = mapIssueToFrontmatter(issue);
    const content = mapIssueToContent(issue);

    let comments: string | undefined;
    if (needsCommentsUpdate && issue.journals) {
      const newJournals = extractNewJournals(issue.journals, existingLastJournalId);
      if (newJournals.length > 0) {
        const newComments = mapJournalsToComments(newJournals, config.comments);
        if (existingFile.comments) {
          comments = `${existingFile.comments}\n\n---\n\n${newComments}`;
        } else {
          comments = newComments;
        }
      } else {
        comments = existingFile.comments || undefined;
      }
    } else {
      comments = existingFile.comments || undefined;
    }

    const changes: SyncIssueResult['changes'] = {};
    if (needsUpdate) {
      changes.frontmatter = true;
      changes.content = true;
    }
    if (needsCommentsUpdate) {
      changes.comments = true;
    }

    if (options.dryRun) {
      const action = existingIssueId ? 'updated' : 'created';
      return {
        success: true,
        issueId: issue.id,
        filename,
        action,
        message: `Would ${action} issue ${issueId} (dry run)`,
        changes,
      };
    }

    await writeMarkdownFile(
      filePath,
      {
        frontmatter,
        content,
        comments,
      },
      config.comments
    );

    const action = existingIssueId ? 'updated' : 'created';
    return {
      success: true,
      issueId: issue.id,
      filename,
      action,
      message: `Successfully ${action} issue ${issueId}`,
      changes,
    };
  } catch (error) {
    return {
      success: false,
      issueId,
      filename: '',
      action: 'skipped',
      message: `Failed to sync issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function extractIssueIdFromUrl(url: string): number | null {
  const match = url.match(/\/issues\/(\d+)(?:\/|$)/);
  if (match) {
    const issueId = parseInt(match[1], 10);
    return isNaN(issueId) ? null : issueId;
  }
  return null;
}
