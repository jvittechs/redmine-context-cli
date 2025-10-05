#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

function createChangeset() {
  const changesetDir = '.changeset';
  const timestamp = Date.now();
  const changesetFile = join(changesetDir, `auto-release-${timestamp}.md`);

  const content = `---
'jvit-redmine-context-cli': patch
---

Automated release`;

  writeFileSync(changesetFile, content);
  console.log('🦋  Created automatic changeset');
}

try {
  // Check if there are unreleased changesets
  let hasChangesets = false;
  try {
    const result = execSync('pnpm changeset status --output=json', { encoding: 'utf8' });
    const status = JSON.parse(result);
    hasChangesets = status.releases && status.releases.length > 0;
  } catch (error) {
    // If changeset status fails, assume no changesets
    hasChangesets = false;
  }

  if (!hasChangesets) {
    console.log('🦋  No changesets found, creating one automatically...');
    createChangeset();
  }

  // Run changeset version
  console.log('🦋  Updating version...');
  execSync('pnpm changeset version', { stdio: 'inherit' });

  // Install dependencies
  console.log('🦋  Installing dependencies...');
  execSync('pnpm install --no-frozen-lockfile', { stdio: 'inherit' });

  // Commit changes
  console.log('🦋  Committing version changes...');
  execSync('git add .', { stdio: 'inherit' });
  execSync('git commit -m "chore: version"', { stdio: 'inherit' });

  // Push to remote
  console.log('🦋  Pushing to remote...');
  execSync('git push', { stdio: 'inherit' });

  // Publish to npm
  console.log('🦋  Publishing to npm...');
  execSync('npm publish --access public', { stdio: 'inherit' });

  console.log('✅ Release completed successfully!');
} catch (error) {
  console.error('❌ Release failed:', error.message);
  process.exit(1);
}
