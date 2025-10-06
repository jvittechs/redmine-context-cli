#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";

// src/config.ts
import { readFile } from "fs/promises";
import { resolve } from "path";
import { parse } from "yaml";
import { z } from "zod";
var RetryConfigSchema = z.object({
  retries: z.number().min(0).default(3),
  baseMs: z.number().min(100).default(300)
});
var FilenameConfigSchema = z.object({
  pattern: z.string().default("{issueId}-{slug}.md"),
  slug: z.object({
    maxLength: z.number().min(10).default(80),
    dedupe: z.boolean().default(true),
    lowercase: z.boolean().default(true)
  }),
  renameOnTitleChange: z.boolean().default(false)
});
var CommentsConfigSchema = z.object({
  anchors: z.object({
    start: z.string().default("<!-- redmine:comments:start -->"),
    end: z.string().default("<!-- redmine:comments:end -->")
  }),
  trackBy: z.enum(["journalId", "createdOn"]).default("journalId")
});
var DefaultsConfigSchema = z.object({
  include: z.array(z.enum(["journals", "relations", "attachments"])).default(["journals"]),
  status: z.string().default("*"),
  pageSize: z.number().min(1).max(100).default(100),
  concurrency: z.number().min(1).max(10).default(4),
  retry: RetryConfigSchema.default({})
});
var ProjectConfigSchema = z.object({
  id: z.number(),
  identifier: z.string()
});
var RedmineConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiAccessToken: z.string().min(1),
  project: ProjectConfigSchema,
  outputDir: z.string().default(".jai1/redmine"),
  defaults: DefaultsConfigSchema.default({}),
  filename: FilenameConfigSchema.default({}),
  comments: CommentsConfigSchema.default({})
});
async function loadConfig(configPath) {
  const filePath = configPath ?? resolve(process.cwd(), "redmine.config.yaml");
  try {
    const content = await readFile(filePath, "utf-8");
    const rawConfig = parse(content);
    return RedmineConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Configuration validation failed: ${error.message}`);
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Configuration file not found: ${filePath}`);
    }
    throw new Error(
      `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// src/api.ts
import { fetch } from "undici";
import pRetry from "p-retry";
import pLimit from "p-limit";
var RedmineApiError = class extends Error {
  constructor(message, status, response) {
    super(message);
    this.status = status;
    this.response = response;
    this.name = "RedmineApiError";
  }
};
var RedmineApiClient = class {
  baseUrl;
  apiAccessToken;
  retryConfig;
  concurrencyLimit;
  constructor(config) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiAccessToken = config.apiAccessToken;
    this.retryConfig = config.defaults.retry;
    this.concurrencyLimit = pLimit(config.defaults.concurrency);
  }
  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      "X-Redmine-API-Key": this.apiAccessToken,
      "Content-Type": "application/json",
      ...options.headers
    };
    const attempt = async () => {
      const response = await fetch(url, {
        ...options,
        headers
      });
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.errors && Array.isArray(errorData.errors)) {
            errorMessage = errorData.errors.join(", ");
          }
        } catch {
        }
        throw new RedmineApiError(errorMessage, response.status);
      }
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        return response.json();
      }
      return response.text();
    };
    return pRetry(attempt, {
      retries: this.retryConfig.retries,
      onFailedAttempt: (error) => {
        console.warn(
          `Request failed (attempt ${error.attemptNumber}/${error.retriesLeft + 1}): ${error.message}`
        );
      },
      factor: 2,
      minTimeout: this.retryConfig.baseMs,
      maxTimeout: this.retryConfig.baseMs * 8
    });
  }
  async checkConnectivity() {
    try {
      await this.request("/projects.json?limit=1");
      return true;
    } catch (error) {
      if (error instanceof RedmineApiError) {
        throw error;
      }
      throw new RedmineApiError(
        `Connectivity check failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async getProject(identifier) {
    return this.request(`/projects/${identifier}.json`);
  }
  async getIssue(issueId, include) {
    const params = new URLSearchParams();
    if (include && include.length > 0) {
      params.append("include", include.join(","));
    }
    const path = `/issues/${issueId}.json${params.toString() ? `?${params.toString()}` : ""}`;
    return this.request(path);
  }
  async getIssues(projectId, options = {}) {
    const params = new URLSearchParams();
    params.append("project_id", projectId.toString());
    if (options.status && options.status !== "*") {
      params.append("status_id", options.status);
    }
    if (options.pageSize) {
      params.append("limit", options.pageSize.toString());
    }
    if (options.offset) {
      params.append("offset", options.offset.toString());
    }
    if (options.include && options.include.length > 0) {
      params.append("include", options.include.join(","));
    }
    if (options.updatedSince) {
      params.append("updated_on", `>=${options.updatedSince}`);
    }
    const path = `/issues.json?${params.toString()}`;
    return this.request(path);
  }
  async getAllIssues(projectId, options = {}) {
    const pageSize = options.pageSize || 100;
    const allIssues = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const response = await this.getIssues(projectId, {
        ...options,
        pageSize,
        offset
      });
      allIssues.push(...response.issues);
      if (options.onProgress) {
        options.onProgress(allIssues.length, response.total_count);
      }
      hasMore = allIssues.length < response.total_count;
      offset += pageSize;
    }
    return allIssues;
  }
  async getIssuesConcurrently(projectId, options = {}) {
    const pageSize = options.pageSize || 100;
    const initialResponse = await this.getIssues(projectId, {
      ...options,
      pageSize: 1
    });
    const totalCount = initialResponse.total_count;
    const totalPages = Math.ceil(totalCount / pageSize);
    const pagePromises = Array.from({ length: totalPages }, (_, index) => {
      const offset = index * pageSize;
      return this.concurrencyLimit(async () => {
        const response = await this.getIssues(projectId, {
          ...options,
          pageSize,
          offset
        });
        if (options.onProgress) {
          options.onProgress(offset + response.issues.length, totalCount);
        }
        return response.issues;
      });
    });
    const pageResults = await Promise.all(pagePromises);
    return pageResults.flat();
  }
};

// src/connectivity-check.ts
async function checkConnectivity(config) {
  const client = new RedmineApiClient(config);
  try {
    const isConnected = await client.checkConnectivity();
    if (!isConnected) {
      return {
        success: false,
        message: "Failed to connect to Redmine API",
        details: {
          baseUrl: config.baseUrl
        }
      };
    }
    const projectResponse = await client.getProject(config.project.identifier);
    return {
      success: true,
      message: `Successfully connected to Redmine and found project "${projectResponse.project.name}"`,
      details: {
        baseUrl: config.baseUrl,
        project: projectResponse.project
      }
    };
  } catch (error) {
    if (error instanceof RedmineApiError) {
      let message = `Redmine API error: ${error.message}`;
      if (error.status === 401) {
        message = "Authentication failed - please check your API access token";
      } else if (error.status === 403) {
        message = "Access forbidden - insufficient permissions for the project";
      } else if (error.status === 404) {
        message = `Project "${config.project.identifier}" not found or inaccessible`;
      }
      return {
        success: false,
        message,
        details: {
          baseUrl: config.baseUrl
        }
      };
    }
    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      details: {
        baseUrl: config.baseUrl
      }
    };
  }
}

// src/sync-issue.ts
import { resolve as resolve2, relative } from "path";

// src/mappers.ts
function mapIssueToFrontmatter(issue) {
  const frontmatter = {
    id: issue.id,
    subject: issue.subject,
    status: issue.status.name,
    priority: issue.priority.name,
    author: issue.author.name,
    created_on: issue.created_on,
    updated_on: issue.updated_on,
    project: issue.project.name,
    tracker: issue.tracker.name
  };
  if (issue.assigned_to) {
    frontmatter.assigned_to = issue.assigned_to.name;
  }
  if (issue.relations && issue.relations.length > 0) {
    frontmatter.relations = issue.relations.map((relation) => ({
      type: relation.relation_type,
      issue_id: relation.issue_to_id,
      delay: relation.delay
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
      content_url: attachment.content_url
    }));
  }
  if (issue.journals && issue.journals.length > 0) {
    const lastJournal = issue.journals.reduce(
      (latest, journal) => journal.id > latest.id ? journal : latest
    );
    frontmatter.lastJournalId = lastJournal.id;
  }
  return frontmatter;
}
function mapIssueToContent(issue) {
  let content = "";
  if (issue.description) {
    content += issue.description;
  }
  return content;
}
function mapJournalsToComments(journals, config) {
  if (!journals || journals.length === 0) {
    return "";
  }
  let comments = "";
  const sortedJournals = [...journals].sort((a, b) => {
    if (config.trackBy === "journalId") {
      return a.id - b.id;
    }
    return new Date(a.created_on).getTime() - new Date(b.created_on).getTime();
  });
  for (const journal of sortedJournals) {
    if (!journal.notes || journal.notes.trim() === "") {
      continue;
    }
    const date = new Date(journal.created_on).toISOString().split("T")[0];
    const time = new Date(journal.created_on).toTimeString().split(" ")[0].substring(0, 5);
    comments += `## ${journal.user.name} - ${date} ${time}

`;
    comments += `${journal.notes}

`;
    if (journal.details && journal.details.length > 0) {
      comments += "**Changes:**\n";
      for (const detail of journal.details) {
        const oldValue = detail.old_value || "(none)";
        const newValue = detail.new_value || "(none)";
        comments += `- ${detail.name}: ${oldValue} \u2192 ${newValue}
`;
      }
      comments += "\n";
    }
    comments += "---\n\n";
  }
  return comments.trim();
}
function extractNewJournals(allJournals, lastJournalId) {
  if (!lastJournalId) {
    return allJournals;
  }
  return allJournals.filter((journal) => journal.id > lastJournalId);
}
function shouldUpdateIssue(remoteIssue, localFrontmatter) {
  const localUpdatedOn = localFrontmatter.updated_on;
  const remoteUpdatedOn = remoteIssue.updated_on;
  if (!localUpdatedOn) {
    return true;
  }
  return new Date(remoteUpdatedOn) > new Date(localUpdatedOn);
}
function shouldUpdateComments(remoteJournals, localFrontmatter) {
  const localLastJournalId = localFrontmatter.lastJournalId;
  if (!localLastJournalId) {
    return remoteJournals.length > 0;
  }
  return remoteJournals.some((journal) => journal.id > localLastJournalId);
}

// src/slug.util.ts
import slugify from "slugify";
function generateSlug(title, config, existingSlugs = /* @__PURE__ */ new Set()) {
  let slug = slugify(title, {
    lower: config.lowercase,
    strict: true,
    remove: /[^\w\s-]/g
  });
  slug = slug.substring(0, config.maxLength);
  if (!config.dedupe) {
    return slug;
  }
  let finalSlug = slug;
  let counter = 1;
  while (existingSlugs.has(finalSlug)) {
    const suffix = `-${counter}`;
    const maxLength = config.maxLength - suffix.length;
    finalSlug = `${slug.substring(0, maxLength)}${suffix}`;
    counter++;
  }
  existingSlugs.add(finalSlug);
  return finalSlug;
}
function generateFilename(issueId, title, config, existingSlugs = /* @__PURE__ */ new Set()) {
  const slug = generateSlug(title, config.slug, existingSlugs);
  return config.pattern.replace("{issueId}", issueId.toString()).replace("{slug}", slug);
}

// src/file.util.ts
import { readFile as readFile2, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import matter from "gray-matter";
async function ensureDir(filePath) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}
async function readMarkdownFile(filePath) {
  try {
    const content = await readFile2(filePath, "utf-8");
    return parseMarkdownContent(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        frontmatter: {},
        content: "",
        comments: null,
        rawContent: ""
      };
    }
    throw error;
  }
}
function parseMarkdownContent(content) {
  if (!content.trim()) {
    return {
      frontmatter: {},
      content: "",
      comments: null,
      rawContent: content
    };
  }
  const { data: frontmatter, content: body } = matter(content);
  const comments = extractCommentsSection(body);
  const mainContent = removeCommentsSection(body);
  return {
    frontmatter,
    content: mainContent,
    comments,
    rawContent: content
  };
}
function extractCommentsSection(content) {
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
function removeCommentsSection(content) {
  const startMatch = content.match(/<!-- redmine:comments:start -->/);
  const endMatch = content.match(/<!-- redmine:comments:end -->/);
  if (!startMatch || !endMatch) {
    return content;
  }
  const startIndex = content.indexOf(startMatch[0]);
  const endIndex = content.indexOf(endMatch[0]) + endMatch[0].length;
  return content.substring(0, startIndex) + content.substring(endIndex).trim();
}
function buildMarkdownContent(data, config) {
  let content = "";
  if (Object.keys(data.frontmatter).length > 0) {
    const frontmatterYaml = matter.stringify("", data.frontmatter).replace(/^---\n|\n---\n?$/g, "");
    content += `---
${frontmatterYaml}---

`;
  }
  content += data.content;
  if (data.comments) {
    content += `

${config.anchors.start}
${data.comments}
${config.anchors.end}`;
  }
  return content;
}
async function writeMarkdownFile(filePath, data, config) {
  await ensureDir(filePath);
  const content = buildMarkdownContent(data, config);
  await writeFile(filePath, content, "utf-8");
}
function extractIssueIdFromFrontmatter(frontmatter) {
  const id = frontmatter.id;
  if (typeof id === "number") {
    return id;
  }
  if (typeof id === "string") {
    const parsed = parseInt(id, 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}
function extractLastJournalId(frontmatter) {
  const lastJournalId = frontmatter.lastJournalId;
  if (typeof lastJournalId === "number") {
    return lastJournalId;
  }
  if (typeof lastJournalId === "string") {
    const parsed = parseInt(lastJournalId, 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

// src/sync-issue.ts
async function syncIssue(issueId, config, options = {}) {
  const client = new RedmineApiClient(config);
  const outputDir = options.outputDir || config.outputDir;
  try {
    const include = config.defaults.include;
    const response = await client.getIssue(issueId, include);
    const issue = response.issue;
    const filename = generateFilename(issue.id, issue.subject, config.filename);
    const filePath = resolve2(outputDir, filename);
    const relativePath = relative(process.cwd(), filePath);
    const existingFile = await readMarkdownFile(filePath);
    const existingIssueId = extractIssueIdFromFrontmatter(existingFile.frontmatter);
    const existingLastJournalId = extractLastJournalId(existingFile.frontmatter);
    if (existingIssueId && existingIssueId !== issue.id) {
      return {
        success: false,
        issueId: issue.id,
        filename,
        filePath: relativePath,
        action: "skipped",
        message: `File ${filename} contains issue ${existingIssueId}, not ${issue.id}`
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
        filePath: relativePath,
        action: "skipped",
        message: `Issue ${issueId} is already up to date`
      };
    }
    const frontmatter = mapIssueToFrontmatter(issue);
    const content = mapIssueToContent(issue);
    let comments;
    if (needsCommentsUpdate && issue.journals) {
      const newJournals = extractNewJournals(issue.journals, existingLastJournalId);
      if (newJournals.length > 0) {
        const newComments = mapJournalsToComments(newJournals, config.comments);
        if (existingFile.comments) {
          comments = `${existingFile.comments}

---

${newComments}`;
        } else {
          comments = newComments;
        }
      } else {
        comments = existingFile.comments || void 0;
      }
    } else {
      comments = existingFile.comments || void 0;
    }
    const changes = {};
    if (needsUpdate) {
      changes.frontmatter = true;
      changes.content = true;
    }
    if (needsCommentsUpdate) {
      changes.comments = true;
    }
    if (options.dryRun) {
      const action2 = existingIssueId ? "updated" : "created";
      return {
        success: true,
        issueId: issue.id,
        filename,
        filePath: relativePath,
        action: action2,
        message: `Would ${action2} issue ${issueId} (dry run)`,
        changes
      };
    }
    await writeMarkdownFile(
      filePath,
      {
        frontmatter,
        content,
        comments
      },
      config.comments
    );
    const action = existingIssueId ? "updated" : "created";
    return {
      success: true,
      issueId: issue.id,
      filename,
      filePath: relativePath,
      action,
      message: `Successfully ${action} issue ${issueId}`,
      changes
    };
  } catch (error) {
    return {
      success: false,
      issueId,
      filename: "",
      filePath: "",
      action: "skipped",
      message: `Failed to sync issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
function extractIssueIdFromUrl(url) {
  const match = url.match(/\/issues\/(\d+)(?:\/|$)/);
  if (match) {
    const issueId = parseInt(match[1], 10);
    return isNaN(issueId) ? null : issueId;
  }
  return null;
}

// src/sync-project.ts
async function syncProject(config, options = {}) {
  const client = new RedmineApiClient(config);
  const pageSize = options.pageSize || config.defaults.pageSize;
  const result = {
    success: true,
    totalIssues: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
  try {
    const issues = await client.getIssuesConcurrently(config.project.id, {
      status: options.status || config.defaults.status,
      pageSize,
      include: config.defaults.include,
      updatedSince: options.updatedSince,
      onProgress: options.onProgress
    });
    result.totalIssues = issues.length;
    if (issues.length === 0) {
      return result;
    }
    const syncPromises = issues.map(async (issue) => {
      const syncResult = await syncIssue(issue.id, config, {
        dryRun: options.dryRun,
        outputDir: options.outputDir
      });
      result.processed++;
      if (syncResult.success) {
        switch (syncResult.action) {
          case "created":
            result.created++;
            break;
          case "updated":
            result.updated++;
            break;
          case "skipped":
            result.skipped++;
            break;
        }
      } else {
        result.failed++;
        result.errors.push({
          issueId: syncResult.issueId,
          error: syncResult.message
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
      error: `Failed to fetch issues: ${error instanceof Error ? error.message : String(error)}`
    });
    return result;
  }
}

// src/cli.ts
import { promises as fs } from "fs";
import { join } from "path";
var program = new Command();
program.name("redmine").description("CLI to sync Redmine issues to local Markdown files").version("0.1.15");
program.on("command:*", (operands) => {
  console.error(`\u274C Unknown command: ${operands[0]}`);
  console.error("\nAvailable commands:");
  console.error("  init        - Initialize configuration in current directory");
  console.error("  check       - Check connectivity to Redmine API");
  console.error("  sync issue  - Sync a single issue");
  console.error("  sync project- Sync all issues in a project");
  console.error('\nUse "redmine --help" for more information.');
  process.exit(1);
});
program.option("-c, --config <path>", "Path to configuration file", "redmine.config.yaml").option("-o, --output-dir <path>", "Output directory for markdown files").option("--dry-run", "Show what would be done without making changes").option("--json", "Output results as JSON");
program.command("init").description("Initialize configuration in current directory").action(async () => {
  const configFileName = "redmine.config.example.yaml";
  const configPath = join(process.cwd(), configFileName);
  const scriptFileName = "redmine-sync-issue.sh";
  try {
    await fs.access(configPath);
    console.log(`\u26A0\uFE0F  ${configFileName} already exists in current directory`);
    console.log("    If you want to recreate it, please delete the existing file first.");
    process.exit(0);
  } catch {
  }
  console.log("\u{1F680} Initializing JVIT Redmine Context CLI in current directory");
  console.log("This will create:");
  console.log(`  - ${configFileName} (example configuration file)`);
  console.log(`  - scripts/${scriptFileName} (utility script)`);
  console.log("");
  try {
    const packageDir = join(__dirname, "..");
    const sourceConfigPath = join(packageDir, configFileName);
    try {
      await fs.copyFile(sourceConfigPath, configPath);
      console.log(`\u2705 Created ${configFileName}`);
    } catch (error) {
      console.error(
        `\u274C Failed to copy ${configFileName}:`,
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
    const scriptsDir = join(process.cwd(), "scripts");
    try {
      await fs.mkdir(scriptsDir, { recursive: true });
    } catch {
    }
    const sourceScriptPath = join(packageDir, "scripts", scriptFileName);
    const targetScriptPath = join(scriptsDir, scriptFileName);
    try {
      await fs.copyFile(sourceScriptPath, targetScriptPath);
      await fs.chmod(targetScriptPath, 493);
      console.log(`\u2705 Created scripts/${scriptFileName} (executable)`);
    } catch (error) {
      console.error(
        `\u274C Failed to copy ${scriptFileName}:`,
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
    console.log("");
    console.log("\u{1F389} Initialization complete!");
    console.log("");
    console.log("Next steps:");
    console.log(`1. Copy ${configFileName} to redmine.config.yaml`);
    console.log("2. Update the configuration with your Redmine details");
    console.log('3. Run "redmine check" to verify connectivity');
    console.log(`4. Use "redmine sync issue --id <number>" or ./scripts/${scriptFileName}`);
  } catch (error) {
    console.error(
      "\u274C Failed to initialize:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
});
program.command("check").description("Check connectivity to Redmine API").action(async (options, command) => {
  const globalOpts = command.parent?.opts() || {};
  const config = await loadConfig(globalOpts.config);
  const result = await checkConnectivity(config);
  if (globalOpts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.success) {
      console.log("\u2705", result.message);
      if (result.details?.project) {
        console.log(
          `   Project: ${result.details.project.name} (${result.details.project.identifier})`
        );
        console.log(`   Project ID: ${result.details.project.id}`);
      }
    } else {
      console.error("\u274C", result.message);
      process.exit(4);
    }
  }
});
program.command("sync").description("Sync Redmine issues to markdown files").addCommand(
  new Command("issue").description("Sync a single issue").option("-i, --id <number>", "Issue ID").option("-u, --url <url>", "Issue URL").action(async (options, command) => {
    const globalOpts = command.parent?.parent?.opts() || {};
    const config = await loadConfig(globalOpts.config);
    let issueId;
    if (options.id) {
      issueId = parseInt(options.id, 10);
      if (isNaN(issueId)) {
        console.error("\u274C Invalid issue ID");
        process.exit(2);
      }
    } else if (options.url) {
      const extractedId = extractIssueIdFromUrl(options.url);
      if (!extractedId) {
        console.error("\u274C Could not extract issue ID from URL");
        process.exit(2);
      }
      issueId = extractedId;
    } else {
      console.error("\u274C Either --id or --url must be provided");
      process.exit(2);
    }
    const result = await syncIssue(issueId, config, {
      dryRun: globalOpts.dryRun,
      outputDir: globalOpts.outputDir
    });
    if (globalOpts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.success) {
        const icon = result.action === "skipped" ? "\u23ED\uFE0F" : "\u2705";
        console.log(`${icon} ${result.message}`);
        if (result.filePath) {
          console.log(`   File: ${result.filePath}`);
        }
      } else {
        console.error("\u274C", result.message);
        process.exit(4);
      }
    }
  })
).addCommand(
  new Command("project").description("Sync all issues in a project").option("-s, --status <status>", "Filter by status (default: *)", "*").option("--updated-since <date>", "Only sync issues updated since YYYY-MM-DD").option("--concurrency <number>", "Number of concurrent requests").option("--page-size <number>", "Page size for API requests").action(async (options, command) => {
    const globalOpts = command.parent?.parent?.opts() || {};
    const config = await loadConfig(globalOpts.config);
    const syncOptions = {
      status: options.status,
      updatedSince: options.updatedSince,
      dryRun: globalOpts.dryRun,
      outputDir: globalOpts.outputDir,
      ...options.concurrency && { concurrency: parseInt(options.concurrency, 10) },
      ...options.pageSize && { pageSize: parseInt(options.pageSize, 10) },
      onProgress: globalOpts.json ? void 0 : (current, total) => {
        process.stdout.write(`\rProgress: ${current}/${total} issues`);
      }
    };
    const result = await syncProject(config, syncOptions);
    if (!globalOpts.json) {
      process.stdout.write("\r");
    }
    if (globalOpts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.success) {
        console.log("\u2705 Sync completed successfully");
        console.log(`   Total issues: ${result.totalIssues}`);
        console.log(`   Created: ${result.created}`);
        console.log(`   Updated: ${result.updated}`);
        console.log(`   Skipped: ${result.skipped}`);
        if (result.failed > 0) {
          console.log(`   Failed: ${result.failed}`);
        }
      } else {
        console.log("\u274C Sync completed with errors");
        console.log(`   Total issues: ${result.totalIssues}`);
        console.log(`   Processed: ${result.processed}`);
        console.log(`   Created: ${result.created}`);
        console.log(`   Updated: ${result.updated}`);
        console.log(`   Skipped: ${result.skipped}`);
        console.log(`   Failed: ${result.failed}`);
        if (result.errors.length > 0) {
          console.log("\nErrors:");
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
//# sourceMappingURL=cli.js.map