import type { RedmineIssue, RedmineJournal } from './api.js';
import type { CommentsConfig } from './config.js';

export interface IssueFrontmatter {
  id: number;
  subject: string;
  status: string;
  priority: string;
  author: string;
  assigned_to?: string;
  created_on: string;
  updated_on: string;
  project: string;
  tracker: string;
  lastJournalId?: number;
  relations?: Array<{
    type: string;
    issue_id: number;
    delay?: number;
  }>;
  attachments?: Array<{
    id: number;
    filename: string;
    filesize: number;
    content_type: string;
    author: string;
    created_on: string;
    content_url?: string;
  }>;
}

export function mapIssueToFrontmatter(issue: RedmineIssue): IssueFrontmatter {
  const frontmatter: IssueFrontmatter = {
    id: issue.id,
    subject: issue.subject,
    status: issue.status.name,
    priority: issue.priority.name,
    author: issue.author.name,
    created_on: issue.created_on,
    updated_on: issue.updated_on,
    project: issue.project.name,
    tracker: issue.tracker.name,
  };

  if (issue.assigned_to) {
    frontmatter.assigned_to = issue.assigned_to.name;
  }

  if (issue.relations && issue.relations.length > 0) {
    frontmatter.relations = issue.relations.map((relation) => ({
      type: relation.relation_type,
      issue_id: relation.issue_to_id,
      delay: relation.delay,
    }));
  }

  if (issue.attachments && issue.attachments.length > 0) {
    frontmatter.attachments = issue.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      filesize: attachment.filesize,
      content_type: attachment.content_type,
      author: attachment.author.name,
      created_on: attachment.created_on,
      content_url: attachment.content_url,
    }));
  }

  if (issue.journals && issue.journals.length > 0) {
    const lastJournal = issue.journals.reduce((latest, journal) =>
      journal.id > latest.id ? journal : latest
    );
    frontmatter.lastJournalId = lastJournal.id;
  }

  return frontmatter;
}

export function mapIssueToContent(issue: RedmineIssue): string {
  let content = '';

  if (issue.description) {
    content += issue.description;
  }

  return content;
}

export function mapJournalsToComments(journals: RedmineJournal[], config: CommentsConfig): string {
  if (!journals || journals.length === 0) {
    return '';
  }

  let comments = '';

  const sortedJournals = [...journals].sort((a, b) => {
    if (config.trackBy === 'journalId') {
      return a.id - b.id;
    }
    return new Date(a.created_on).getTime() - new Date(b.created_on).getTime();
  });

  for (const journal of sortedJournals) {
    if (!journal.notes || journal.notes.trim() === '') {
      continue;
    }

    const date = new Date(journal.created_on).toISOString().split('T')[0];
    const time = new Date(journal.created_on).toTimeString().split(' ')[0].substring(0, 5);

    comments += `## ${journal.user.name} - ${date} ${time}\n\n`;
    comments += `${journal.notes}\n\n`;

    if (journal.details && journal.details.length > 0) {
      comments += '**Changes:**\n';
      for (const detail of journal.details) {
        const oldValue = detail.old_value || '(none)';
        const newValue = detail.new_value || '(none)';
        comments += `- ${detail.name}: ${oldValue} → ${newValue}\n`;
      }
      comments += '\n';
    }

    comments += '---\n\n';
  }

  return comments.trim();
}

export function extractNewJournals(
  allJournals: RedmineJournal[],
  lastJournalId: number | null
): RedmineJournal[] {
  if (!lastJournalId) {
    return allJournals;
  }

  return allJournals.filter((journal) => journal.id > lastJournalId);
}

export function shouldUpdateIssue(
  remoteIssue: RedmineIssue,
  localFrontmatter: Record<string, unknown>
): boolean {
  const localUpdatedOn = localFrontmatter.updated_on as string;
  const remoteUpdatedOn = remoteIssue.updated_on;

  if (!localUpdatedOn) {
    return true;
  }

  return new Date(remoteUpdatedOn) > new Date(localUpdatedOn);
}

export function shouldUpdateComments(
  remoteJournals: RedmineJournal[],
  localFrontmatter: Record<string, unknown>
): boolean {
  const localLastJournalId = localFrontmatter.lastJournalId as number;

  if (!localLastJournalId) {
    return remoteJournals.length > 0;
  }

  return remoteJournals.some((journal) => journal.id > localLastJournalId);
}
