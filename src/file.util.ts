import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import matter from 'gray-matter';
import type { CommentsConfig } from './config.js';

export interface MarkdownData {
  frontmatter: Record<string, unknown>;
  content: string;
  comments?: string;
}

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
  comments: string | null;
  rawContent: string;
}

export async function ensureDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}

export async function readMarkdownFile(filePath: string): Promise<ParsedMarkdown> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseMarkdownContent(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        frontmatter: {},
        content: '',
        comments: null,
        rawContent: '',
      };
    }
    throw error;
  }
}

export function parseMarkdownContent(content: string): ParsedMarkdown {
  if (!content.trim()) {
    return {
      frontmatter: {},
      content: '',
      comments: null,
      rawContent: content,
    };
  }

  const { data: frontmatter, content: body } = matter(content);

  const comments = extractCommentsSection(body);
  const mainContent = removeCommentsSection(body);

  return {
    frontmatter,
    content: mainContent,
    comments,
    rawContent: content,
  };
}

export function extractCommentsSection(content: string): string | null {
  const startMatch = content.match(/<!-- redmine:comments:start -->/);
  const endMatch = content.match(/<!-- redmine:comments:end -->/);

  if (!startMatch || !endMatch) {
    return null;
  }

  const startIndex = content.indexOf(startMatch[0]) + startMatch[0].length;
  const endIndex = content.indexOf(endMatch[0]);

  if (startIndex >= endIndex) {
    return null;
  }

  return content.substring(startIndex, endIndex).trim();
}

export function removeCommentsSection(content: string): string {
  const startMatch = content.match(/<!-- redmine:comments:start -->/);
  const endMatch = content.match(/<!-- redmine:comments:end -->/);

  if (!startMatch || !endMatch) {
    return content;
  }

  const startIndex = content.indexOf(startMatch[0]);
  const endIndex = content.indexOf(endMatch[0]) + endMatch[0].length;

  return content.substring(0, startIndex) + content.substring(endIndex).trim();
}

export function buildMarkdownContent(data: MarkdownData, config: CommentsConfig): string {
  let content = '';

  if (Object.keys(data.frontmatter).length > 0) {
    const frontmatterYaml = matter.stringify('', data.frontmatter).replace(/^---\n|\n---\n?$/g, '');
    content += `---\n${frontmatterYaml}---\n\n`;
  }

  content += data.content;

  if (data.comments) {
    content += `\n\n${config.anchors.start}\n${data.comments}\n${config.anchors.end}`;
  }

  return content;
}

export async function writeMarkdownFile(
  filePath: string,
  data: MarkdownData,
  config: CommentsConfig
): Promise<void> {
  await ensureDir(filePath);
  const content = buildMarkdownContent(data, config);
  await writeFile(filePath, content, 'utf-8');
}

export function extractIssueIdFromFrontmatter(frontmatter: Record<string, unknown>): number | null {
  const id = frontmatter.id as number | string | undefined;
  if (typeof id === 'number') {
    return id;
  }
  if (typeof id === 'string') {
    const parsed = parseInt(id, 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function extractLastJournalId(frontmatter: Record<string, unknown>): number | null {
  const lastJournalId = frontmatter.lastJournalId as number | string | undefined;
  if (typeof lastJournalId === 'number') {
    return lastJournalId;
  }
  if (typeof lastJournalId === 'string') {
    const parsed = parseInt(lastJournalId, 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}
