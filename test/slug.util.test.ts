import { describe, it, expect } from 'vitest';
import { generateSlug, generateFilename } from '../src/slug.util.js';
import type { FilenameConfig } from '../src/config.js';

describe('slug.util', () => {
  describe('generateSlug', () => {
    it('should generate basic slug', () => {
      const config: FilenameConfig['slug'] = {
        maxLength: 80,
        dedupe: false,
        lowercase: true,
      };

      const slug = generateSlug('Hello World Test', config);
      expect(slug).toBe('hello-world-test');
    });

    it('should handle special characters', () => {
      const config: FilenameConfig['slug'] = {
        maxLength: 80,
        dedupe: false,
        lowercase: true,
      };

      const slug = generateSlug('Test with @#$% special chars!', config);
      expect(slug).toBe('test-with-dollarpercent-special-chars');
    });

    it('should respect maxLength', () => {
      const config: FilenameConfig['slug'] = {
        maxLength: 20,
        dedupe: false,
        lowercase: true,
      };

      const slug = generateSlug('This is a very long title that should be truncated', config);
      expect(slug.length).toBeLessThanOrEqual(20);
    });

    it('should handle deduplication', () => {
      const config: FilenameConfig['slug'] = {
        maxLength: 80,
        dedupe: true,
        lowercase: true,
      };

      const existingSlugs = new Set<string>(['test-slug']);

      const slug1 = generateSlug('Test Slug', config, existingSlugs);
      expect(slug1).toBe('test-slug-1');

      const slug2 = generateSlug('Test Slug', config, existingSlugs);
      expect(slug2).toBe('test-slug-2');
    });

    it('should preserve case when lowercase is false', () => {
      const config: FilenameConfig['slug'] = {
        maxLength: 80,
        dedupe: false,
        lowercase: false,
      };

      const slug = generateSlug('Hello World Test', config);
      expect(slug).toBe('Hello-World-Test');
    });
  });

  describe('generateFilename', () => {
    const config: FilenameConfig = {
      pattern: '{issueId}-{slug}.md',
      slug: {
        maxLength: 80,
        dedupe: false,
        lowercase: true,
      },
      renameOnTitleChange: false,
    };

    it('should generate filename with pattern', () => {
      const filename = generateFilename(123, 'Test Issue Title', config);
      expect(filename).toBe('123-test-issue-title.md');
    });

    it('should handle different patterns', () => {
      const customConfig = {
        ...config,
        pattern: '{slug}-{issueId}.md',
      };

      const filename = generateFilename(456, 'Another Test', customConfig);
      expect(filename).toBe('another-test-456.md');
    });
  });
});
