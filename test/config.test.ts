import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/config.js';

describe('config validation', () => {
  it('should validate valid configuration', () => {
    const validConfig = {
      baseUrl: 'https://redmine.example.com',
      apiAccessToken: 'test-token',
      project: {
        id: 123,
        identifier: 'test-project',
      },
      outputDir: '.jai1/redmine',
      defaults: {
        include: ['journals'],
        status: '*',
        pageSize: 100,
        concurrency: 4,
        retry: {
          retries: 3,
          baseMs: 300,
        },
      },
      filename: {
        pattern: '{issueId}-{slug}.md',
        slug: {
          maxLength: 80,
          dedupe: true,
          lowercase: true,
        },
        renameOnTitleChange: false,
      },
      comments: {
        anchors: {
          start: '<!-- redmine:comments:start -->',
          end: '<!-- redmine:comments:end -->',
        },
        trackBy: 'journalId',
      },
    };

    expect(() => validateConfig(validConfig)).not.toThrow();
  });

  it('should reject invalid baseUrl', () => {
    const invalidConfig = {
      baseUrl: 'not-a-url',
      apiAccessToken: 'test-token',
      project: {
        id: 123,
        identifier: 'test-project',
      },
    };

    expect(() => validateConfig(invalidConfig)).toThrow();
  });

  it('should reject empty apiAccessToken', () => {
    const invalidConfig = {
      baseUrl: 'https://redmine.example.com',
      apiAccessToken: '',
      project: {
        id: 123,
        identifier: 'test-project',
      },
    };

    expect(() => validateConfig(invalidConfig)).toThrow();
  });

  it('should use default values', () => {
    const minimalConfig = {
      baseUrl: 'https://redmine.example.com',
      apiAccessToken: 'test-token',
      project: {
        id: 123,
        identifier: 'test-project',
      },
      filename: {
        pattern: '{issueId}-{slug}.md',
        slug: {
          maxLength: 80,
          dedupe: true,
          lowercase: true,
        },
        renameOnTitleChange: false,
      },
      comments: {
        anchors: {
          start: '<!-- redmine:comments:start -->',
          end: '<!-- redmine:comments:end -->',
        },
        trackBy: 'journalId',
      },
    };

    const validated = validateConfig(minimalConfig);
    expect(validated.outputDir).toBe('.jai1/redmine');
    expect(validated.defaults.status).toBe('*');
    expect(validated.defaults.pageSize).toBe(100);
    expect(validated.filename.pattern).toBe('{issueId}-{slug}.md');
  });
});
