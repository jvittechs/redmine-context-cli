#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

console.log('🚀 Starting release process...');

try {
  // Check if there are changesets to release
  try {
    const changesetStatus = execSync('pnpm changeset status', { encoding: 'utf8' });

    if (changesetStatus.includes('No changesets found')) {
      console.log('📝 No changesets found. Creating an empty changeset for patch release...');
      execSync('pnpm changeset add --empty', { stdio: 'inherit' });
    }
  } catch (error) {
    if (error.message.includes('no changesets were found')) {
      console.log('📝 No changesets found. Creating an empty changeset for patch release...');
      execSync('pnpm changeset add --empty', { stdio: 'inherit' });
    } else {
      throw error;
    }
  }

  // Build the project
  console.log('📦 Building project...');
  execSync('pnpm build', { stdio: 'inherit' });

  // Run tests
  console.log('🧪 Running tests...');
  execSync('pnpm test', { stdio: 'inherit' });

  // Version bump with changesets (this updates package.json and CHANGELOG.md)
  console.log('📝 Versioning packages...');
  execSync('pnpm changeset version', { stdio: 'inherit' });

  // Get the new version
  const newPackageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const newVersion = newPackageJson.version;
  console.log(`🔢 Version bumped to ${newVersion}`);

  // Commit the version changes
  console.log('📋 Committing version changes...');
  execSync('git add package.json CHANGELOG.md', { stdio: 'inherit' });
  execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });

  // Push to remote
  console.log('📤 Pushing to remote...');
  execSync('git push origin main', { stdio: 'inherit' });

  // Publish to npm
  console.log('📦 Publishing to npm...');
  execSync('pnpm changeset publish', { stdio: 'inherit' });

  console.log(`✅ Release v${newVersion} completed successfully!`);
} catch (error) {
  console.error('❌ Release failed:', error.message);
  process.exit(1);
}
