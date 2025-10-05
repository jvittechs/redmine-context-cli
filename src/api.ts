import { fetch } from 'undici';
import pRetry from 'p-retry';
import pLimit from 'p-limit';
import type { RedmineConfig, RetryConfig } from './config.js';

export interface RedmineIssue {
  id: number;
  subject: string;
  description: string;
  status: { id: number; name: string };
  priority: { id: number; name: string };
  author: { id: number; name: string };
  assigned_to?: { id: number; name: string };
  created_on: string;
  updated_on: string;
  project: { id: number; name: string };
  tracker: { id: number; name: string };
  journals?: RedmineJournal[];
  relations?: RedmineRelation[];
  attachments?: RedmineAttachment[];
}

export interface RedmineJournal {
  id: number;
  user: { id: number; name: string };
  notes?: string;
  created_on: string;
  details?: Array<{
    name: string;
    old_value: string;
    new_value: string;
  }>;
}

export interface RedmineRelation {
  id: number;
  issue_to_id: number;
  relation_type: string;
  delay?: number;
}

export interface RedmineAttachment {
  id: number;
  filename: string;
  filesize: number;
  content_type: string;
  author: { id: number; name: string };
  created_on: string;
  content_url?: string;
}

export interface RedmineIssueResponse {
  issue: RedmineIssue;
}

export interface RedmineIssuesResponse {
  issues: RedmineIssue[];
  total_count: number;
  offset: number;
  limit: number;
}

export interface RedmineProjectResponse {
  project: {
    id: number;
    identifier: string;
    name: string;
    created_on: string;
    updated_on: string;
  };
}

export class RedmineApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'RedmineApiError';
  }
}

export class RedmineApiClient {
  private readonly baseUrl: string;
  private readonly apiAccessToken: string;
  private readonly retryConfig: RetryConfig;
  private readonly concurrencyLimit: pLimit.Limit;

  constructor(config: RedmineConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiAccessToken = config.apiAccessToken;
    this.retryConfig = config.defaults.retry;
    this.concurrencyLimit = pLimit(config.defaults.concurrency);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers = {
      'X-Redmine-API-Key': this.apiAccessToken,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const attempt = async (): Promise<T> => {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
          const errorData = (await response.json()) as { errors?: string[] };
          if (errorData.errors && Array.isArray(errorData.errors)) {
            errorMessage = errorData.errors.join(', ');
          }
        } catch {
          // Ignore JSON parsing errors for error response
        }

        throw new RedmineApiError(errorMessage, response.status);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return response.json() as Promise<T>;
      }

      return response.text() as unknown as T;
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
      maxTimeout: this.retryConfig.baseMs * 8,
    });
  }

  async checkConnectivity(): Promise<boolean> {
    try {
      await this.request<RedmineProjectResponse>('/projects.json?limit=1');
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

  async getProject(identifier: string): Promise<RedmineProjectResponse> {
    return this.request<RedmineProjectResponse>(`/projects/${identifier}.json`);
  }

  async getIssue(issueId: number, include?: string[]): Promise<RedmineIssueResponse> {
    const params = new URLSearchParams();
    if (include && include.length > 0) {
      params.append('include', include.join(','));
    }

    const path = `/issues/${issueId}.json${params.toString() ? `?${params.toString()}` : ''}`;
    return this.request<RedmineIssueResponse>(path);
  }

  async getIssues(
    projectId: number,
    options: {
      status?: string;
      pageSize?: number;
      offset?: number;
      include?: string[];
      updatedSince?: string;
    } = {}
  ): Promise<RedmineIssuesResponse> {
    const params = new URLSearchParams();
    params.append('project_id', projectId.toString());

    if (options.status && options.status !== '*') {
      params.append('status_id', options.status);
    }

    if (options.pageSize) {
      params.append('limit', options.pageSize.toString());
    }

    if (options.offset) {
      params.append('offset', options.offset.toString());
    }

    if (options.include && options.include.length > 0) {
      params.append('include', options.include.join(','));
    }

    if (options.updatedSince) {
      params.append('updated_on', `>=${options.updatedSince}`);
    }

    const path = `/issues.json?${params.toString()}`;
    return this.request<RedmineIssuesResponse>(path);
  }

  async getAllIssues(
    projectId: number,
    options: {
      status?: string;
      pageSize?: number;
      include?: string[];
      updatedSince?: string;
      onProgress?: (current: number, total: number) => void;
    } = {}
  ): Promise<RedmineIssue[]> {
    const pageSize = options.pageSize || 100;
    const allIssues: RedmineIssue[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getIssues(projectId, {
        ...options,
        pageSize,
        offset,
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

  async getIssuesConcurrently(
    projectId: number,
    options: {
      status?: string;
      pageSize?: number;
      include?: string[];
      updatedSince?: string;
      onProgress?: (current: number, total: number) => void;
    } = {}
  ): Promise<RedmineIssue[]> {
    const pageSize = options.pageSize || 100;

    // First, get the total count
    const initialResponse = await this.getIssues(projectId, {
      ...options,
      pageSize: 1,
    });

    const totalCount = initialResponse.total_count;
    const totalPages = Math.ceil(totalCount / pageSize);

    const pagePromises = Array.from({ length: totalPages }, (_, index) => {
      const offset = index * pageSize;

      return this.concurrencyLimit(async () => {
        const response = await this.getIssues(projectId, {
          ...options,
          pageSize,
          offset,
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
}
