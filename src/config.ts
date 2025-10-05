import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const RetryConfigSchema = z.object({
  retries: z.number().min(0).default(3),
  baseMs: z.number().min(100).default(300),
});

const FilenameConfigSchema = z.object({
  pattern: z.string().default('{issueId}-{slug}.md'),
  slug: z.object({
    maxLength: z.number().min(10).default(80),
    dedupe: z.boolean().default(true),
    lowercase: z.boolean().default(true),
  }),
  renameOnTitleChange: z.boolean().default(false),
});

const CommentsConfigSchema = z.object({
  anchors: z.object({
    start: z.string().default('<!-- redmine:comments:start -->'),
    end: z.string().default('<!-- redmine:comments:end -->'),
  }),
  trackBy: z.enum(['journalId', 'createdOn']).default('journalId'),
});

const DefaultsConfigSchema = z.object({
  include: z.array(z.enum(['journals', 'relations', 'attachments'])).default(['journals']),
  status: z.string().default('*'),
  pageSize: z.number().min(1).max(100).default(100),
  concurrency: z.number().min(1).max(10).default(4),
  retry: RetryConfigSchema.default({}),
});

const ProjectConfigSchema = z.object({
  id: z.number(),
  identifier: z.string(),
});

const RedmineConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiAccessToken: z.string().min(1),
  project: ProjectConfigSchema,
  outputDir: z.string().default('.jai1/redmine'),
  defaults: DefaultsConfigSchema.default({}),
  filename: FilenameConfigSchema.default({}),
  comments: CommentsConfigSchema.default({}),
});

export type RedmineConfig = z.infer<typeof RedmineConfigSchema>;
export type RetryConfig = z.infer<typeof RetryConfigSchema>;
export type FilenameConfig = z.infer<typeof FilenameConfigSchema>;
export type CommentsConfig = z.infer<typeof CommentsConfigSchema>;
export type DefaultsConfig = z.infer<typeof DefaultsConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export async function loadConfig(configPath?: string): Promise<RedmineConfig> {
  const filePath = configPath ?? resolve(process.cwd(), 'redmine.config.yaml');

  try {
    const content = await readFile(filePath, 'utf-8');
    const rawConfig = parse(content);

    return RedmineConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Configuration validation failed: ${error.message}`);
    }

    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    throw new Error(
      `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function validateConfig(config: unknown): RedmineConfig {
  return RedmineConfigSchema.parse(config);
}
