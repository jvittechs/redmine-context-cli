#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

console.log('🚀 Starting release process...');

try {
  // Check if there are changesets to release
  const changesetStatus = execSync('pnpm changeset status', { encoding: 'utf8' });

  if (changesetStatus.includes('No changesets found')) {
    console.log('❌ No changesets found. Create a changeset first:');
    console.log('   pnpm changeset');
    process.exit(1);
  }

  // Build the project
  console.log('📦 Building project...');
  execSync('pnpm build', { stdio: 'inherit' });

  // Run tests
  console.log('🧪 Running tests...');
  execSync('pnpm test', { stdio: 'inherit' });

  // Version and publish with changesets
  console.log('📝 Versioning and publishing...');
  execSync('pnpm changeset version', { stdio: 'inherit' });
  execSync('pnpm changeset publish', { stdio: 'inherit' });

  console.log('✅ Release completed successfully!');
} catch (error) {
  console.error('❌ Release failed:', error.message);
  process.exit(1);
}
