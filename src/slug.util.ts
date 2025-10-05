import slugify from 'slugify';
import type { FilenameConfig } from './config.js';

export function generateSlug(
  title: string,
  config: FilenameConfig['slug'],
  existingSlugs: Set<string> = new Set()
): string {
  let slug = slugify(title, {
    lower: config.lowercase,
    strict: true,
    remove: /[^\w\s-]/g,
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

export function generateFilename(
  issueId: number,
  title: string,
  config: FilenameConfig,
  existingSlugs: Set<string> = new Set()
): string {
  const slug = generateSlug(title, config.slug, existingSlugs);

  return config.pattern.replace('{issueId}', issueId.toString()).replace('{slug}', slug);
}
