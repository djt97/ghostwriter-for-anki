const path = require('path');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');

const REQUIRED_RELEASE_FILES = [
  'manifest.json',
  'LICENSE',
  'background.js',
  'content.js',
  'panel.html',
  'panel.js',
  'review.html',
  'review.js',
  'options.html',
  'options.js',
  'privacy.md',
  'PRIVACY_POLICY.md',
  'THIRD_PARTY_NOTICES.md',
  'APACHE-2.0.txt',
  'libs/markdown-it.min.js',
  'libs/mathjax/mathjax-bundle.js',
  'libs/mathjax/mathjax-bundle.js.LICENSE.txt'
];

const FORBIDDEN_RELEASE_PATHS = [
  '.git',
  'node_modules',
  'tests',
  'docs',
  'scripts',
  'package.json',
  'package-lock.json',
  'eslint.config.js',
  'playwright.config.ts',
  'AGENTS.md',
  'LISTING.md',
  'GHOSTWRITER_V2_PLAN.md',
  'licences'
];

const EXCLUDES = [
  '.git',
  '.github',
  '.claude',
  '.codex',
  '.DS_Store',
  '.gitignore',
  'dist',
  'node_modules',
  'mathjax-entry.js',
  'webpack.config.js',
  'stubs',
  'mathjax-config.js',
  'libs/mathjax/tex-mml-chtml.js',
  'tests',
  'test-results',
  'playwright-report',
  'playwright.config.ts',
  'package.json',
  'package-lock.json',
  'scripts',
  'audit',
  'explainer-video',
  'docs',
  'AGENTS.md',
  'CLAUDE.md',
  'eslint.config.js',
  'LISTING.md',
  'GHOSTWRITER_V2_PLAN.md',
  'README.md',
  'licences',
  'vendor'
];

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

// The extension bundle never contains video/audio; stray recordings dropped in the repo root
// (demo takes, narration WAVs) must not balloon the store zip.
const EXCLUDED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.wav', '.m4a', '.aiff', '.aif']);

function isExcluded(relPath, excludes) {
  if (excludes.some((entry) => relPath === entry || relPath.startsWith(`${entry}/`))) return true;
  if (EXCLUDED_EXTENSIONS.has(path.extname(relPath).toLowerCase())) return true;
  // Root-level images are working assets, not extension resources (icons live in icons/).
  if (!relPath.includes('/') && /\.(png|jpe?g|gif)$/i.test(relPath)) return true;
  return false;
}

async function copyDir(src, dest, excludes) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const srcPath = path.join(src, entry.name);
    const relPath = normalizePath(path.relative(ROOT, srcPath));
    if (isExcluded(relPath, excludes)) {
      return;
    }
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, excludes);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }));
}

async function hardenReleaseBuild(buildRoot) {
  // Disable the __qf_ci test hooks in the shipped build so a visited page cannot set
  // ?__qf_ci on itself and drive the content-script test message handlers.
  const contentPath = path.join(buildRoot, 'content.js');
  const src = await fs.readFile(contentPath, 'utf8');
  const marker = 'const QF_TEST_MODE = /\\b__qf_ci\\b/i.test(location.search + location.hash);';
  if (!src.includes(marker)) {
    throw new Error('build-release: QF_TEST_MODE marker not found in content.js; update scripts/build-release.js so release test hooks stay disabled.');
  }
  const patched = src.replace(marker, 'const QF_TEST_MODE = false; // test hooks disabled in release build');
  await fs.writeFile(contentPath, patched);
}

async function prepareDist() {
  if (existsSync(DIST_DIR)) {
    await fs.rm(DIST_DIR, { recursive: true, force: true });
  }
  await fs.mkdir(DIST_DIR, { recursive: true });
}

async function assertReleaseContents(buildRoot) {
  const missing = REQUIRED_RELEASE_FILES.filter((relPath) => !existsSync(path.join(buildRoot, relPath)));
  const forbidden = FORBIDDEN_RELEASE_PATHS.filter((relPath) => existsSync(path.join(buildRoot, relPath)));
  if (missing.length || forbidden.length) {
    throw new Error([
      'Release contents check failed.',
      missing.length ? `Missing required files: ${missing.join(', ')}` : '',
      forbidden.length ? `Forbidden files present: ${forbidden.join(', ')}` : ''
    ].filter(Boolean).join(' '));
  }
}

function buildMathJaxBundle() {
  execSync('npx webpack', { cwd: ROOT, stdio: 'inherit' });
}

async function build() {
  const buildRoot = path.join(DIST_DIR, 'ghostwriter');
  await copyDir(ROOT, buildRoot, EXCLUDES);
  await hardenReleaseBuild(buildRoot);
  await assertReleaseContents(buildRoot);

  const zipPath = path.join(DIST_DIR, 'ghostwriter.zip');
  if (existsSync(zipPath)) {
    await fs.rm(zipPath, { force: true });
  }
  execSync(`zip -r "${zipPath}" .`, { cwd: buildRoot, stdio: 'inherit' });
}

async function main() {
  buildMathJaxBundle();
  await prepareDist();
  await build();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
