import { describe, it, expect } from 'vitest';
import {
  parseMarkdownContent,
  extractCommentsSection,
  removeCommentsSection,
  buildMarkdownContent,
  extractIssueIdFromFrontmatter,
  extractLastJournalId,
} from '../src/file.util.js';
import type { CommentsConfig } from '../src/config.js';

describe('file.util', () => {
  const commentsConfig: CommentsConfig = {
    anchors: {
      start: '<!-- redmine:comments:start -->',
      end: '<!-- redmine:comments:end -->',
    },
    trackBy: 'journalId',
  };

  describe('parseMarkdownContent', () => {
    it('should parse empty content', () => {
      const result = parseMarkdownContent('');
      expect(result.frontmatter).toEqual({});
      expect(result.content).toBe('');
      expect(result.comments).toBeNull();
    });

    it('should parse content with frontmatter', () => {
      const content = `---
id: 123
subject: Test Issue
---
# Test Content`;

      const result = parseMarkdownContent(content);
      expect(result.frontmatter).toEqual({ id: 123, subject: 'Test Issue' });
      expect(result.content).toBe('# Test Content');
      expect(result.comments).toBeNull();
    });

    it('should parse content with comments', () => {
      const content = `---
id: 123
---
# Test Content

<!-- redmine:comments:start -->
## User - 2023-01-01
This is a comment.
<!-- redmine:comments:end -->`;

      const result = parseMarkdownContent(content);
      expect(result.frontmatter).toEqual({ id: 123 });
      expect(result.content).toBe('# Test Content\n\n');
      expect(result.comments).toBe('## User - 2023-01-01\nThis is a comment.');
    });
  });

  describe('extractCommentsSection', () => {
    it('should extract comments between anchors', () => {
      const content = `Some content
<!-- redmine:comments:start -->
Comment content
<!-- redmine:comments:end -->
More content`;

      const comments = extractCommentsSection(content);
      expect(comments).toBe('Comment content');
    });

    it('should return null if anchors are missing', () => {
      const content = 'Some content without comments';
      const comments = extractCommentsSection(content);
      expect(comments).toBeNull();
    });
  });

  describe('removeCommentsSection', () => {
    it('should remove comments section', () => {
      const content = `# Main content

<!-- redmine:comments:start -->
Comment content
<!-- redmine:comments:end -->

More content`;

      const result = removeCommentsSection(content);
      expect(result).toBe('# Main content\n\nMore content');
    });

    it('should return original content if no comments', () => {
      const content = '# Main content';
      const result = removeCommentsSection(content);
      expect(result).toBe(content);
    });
  });

  describe('buildMarkdownContent', () => {
    it('should build content with frontmatter and comments', () => {
      const data = {
        frontmatter: { id: 123, subject: 'Test' },
        content: '# Test Content',
        comments: '## Comment\nThis is a comment.',
      };

      const result = buildMarkdownContent(data, commentsConfig);
      expect(result).toContain('---');
      expect(result).toContain('id: 123');
      expect(result).toContain('# Test Content');
      expect(result).toContain('<!-- redmine:comments:start -->');
      expect(result).toContain('## Comment');
      expect(result).toContain('<!-- redmine:comments:end -->');
    });

    it('should build content without frontmatter', () => {
      const data = {
        frontmatter: {},
        content: '# Test Content',
      };

      const result = buildMarkdownContent(data, commentsConfig);
      expect(result).toBe('# Test Content');
    });
  });

  describe('extractIssueIdFromFrontmatter', () => {
    it('should extract number id', () => {
      const frontmatter = { id: 123 };
      expect(extractIssueIdFromFrontmatter(frontmatter)).toBe(123);
    });

    it('should extract string id', () => {
      const frontmatter = { id: '456' };
      expect(extractIssueIdFromFrontmatter(frontmatter)).toBe(456);
    });

    it('should return null for invalid id', () => {
      const frontmatter = { id: 'invalid' };
      expect(extractIssueIdFromFrontmatter(frontmatter)).toBeNull();
    });

    it('should return null for missing id', () => {
      const frontmatter = {};
      expect(extractIssueIdFromFrontmatter(frontmatter)).toBeNull();
    });
  });

  describe('extractLastJournalId', () => {
    it('should extract number lastJournalId', () => {
      const frontmatter = { lastJournalId: 789 };
      expect(extractLastJournalId(frontmatter)).toBe(789);
    });

    it('should extract string lastJournalId', () => {
      const frontmatter = { lastJournalId: '101' };
      expect(extractLastJournalId(frontmatter)).toBe(101);
    });

    it('should return null for missing lastJournalId', () => {
      const frontmatter = {};
      expect(extractLastJournalId(frontmatter)).toBeNull();
    });
  });
});
