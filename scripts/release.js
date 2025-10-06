#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

console.log('🚀 Starting release process...');

try {
  // Check if there are changesets to release
  try {
    const changesetStatus = execSync('pnpm changeset status', { encoding: 'utf8' });

    if (changesetStatus.includes('No changesets found')) {
      console.log('📝 No changesets found. Creating a patch changeset...');
      // Create a patch changeset file directly
      const changesetId = randomBytes(4).toString('hex');
      const changesetContent = `---
"jvit-redmine-context-cli": patch
---

Automatic patch release
`;
      writeFileSync(`.changeset/${changesetId}.md`, changesetContent);
      console.log(`✅ Created changeset: ${changesetId}.md`);
    }
  } catch (error) {
    if (error.message.includes('no changesets were found')) {
      console.log('📝 No changesets found. Creating a patch changeset...');
      // Create a patch changeset file directly
      const changesetId = randomBytes(4).toString('hex');
      const changesetContent = `---
"jvit-redmine-context-cli": patch
---

Automatic patch release
`;
      writeFileSync(`.changeset/${changesetId}.md`, changesetContent);
      console.log(`✅ Created changeset: ${changesetId}.md`);
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

  // Check if version actually changed
  if (packageJson.version !== newVersion) {
    // Update version in CLI source code
    console.log('🔄 Updating version in CLI source code...');
    const cliFilePath = join('src', 'cli.ts');
    let cliContent = readFileSync(cliFilePath, 'utf8');

    // Update version line in CLI
    const versionRegex = /\.version\('([^']+)'\);/;
    const match = cliContent.match(versionRegex);

    if (match) {
      cliContent = cliContent.replace(versionRegex, `.version('${newVersion}');`);
      writeFileSync(cliFilePath, cliContent);
      console.log(`✅ Updated CLI version from ${match[1]} to ${newVersion}`);
    } else {
      console.log('⚠️  Could not find version line in CLI source code');
    }

    // Rebuild with updated version
    console.log('🔄 Rebuilding with updated version...');
    execSync('pnpm build', { stdio: 'inherit' });

    // Commit the version changes
    console.log('📋 Committing version changes...');
    execSync('git add package.json CHANGELOG.md src/cli.ts dist/', { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });

    // Push to remote
    console.log('📤 Pushing to remote...');
    execSync('git push origin main', { stdio: 'inherit' });
  } else {
    console.log('ℹ️  No version change detected, skipping git commit and push');
  }

  // Publish to npm
  console.log('📦 Publishing to npm...');
  try {
    execSync('npm publish --access public', { stdio: 'inherit' });
  } catch (error) {
    console.log('⚠️  npm publish failed. You may need to publish manually:');
    console.log(`   npm publish --access public`);
    console.log('Error:', error.message);
  }

  console.log(`✅ Release v${newVersion} completed successfully!`);
} catch (error) {
  console.error('❌ Release failed:', error.message);
  process.exit(1);
}
