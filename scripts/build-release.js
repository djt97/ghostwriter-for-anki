const path = require('path');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');

const EXCLUDES = [
  '.git',
  '.github',
  '.claude',
  '.codex',
  'dist',
  'node_modules',
  'mathjax-entry.js',
  'webpack.config.js',
  'stubs/mathjax-version.js',
  'mathjax-config.js',
  'libs/mathjax/tex-mml-chtml.js',
  'tests',
  'playwright.config.ts',
  'package.json',
  'package-lock.json',
  'scripts',
  'audit',
  'explainer-video',
  'docs',
  'CLAUDE.md',
  'LISTING.md',
  'GHOSTWRITER_V2_PLAN.md',
  'README.md',
  'licences'
];

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function isExcluded(relPath, excludes) {
  return excludes.some((entry) => relPath === entry || relPath.startsWith(`${entry}/`));
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

async function prepareDist() {
  if (existsSync(DIST_DIR)) {
    await fs.rm(DIST_DIR, { recursive: true, force: true });
  }
  await fs.mkdir(DIST_DIR, { recursive: true });
}

function buildMathJaxBundle() {
  execSync('npx webpack', { cwd: ROOT, stdio: 'inherit' });
}

async function build() {
  const buildRoot = path.join(DIST_DIR, 'ghostwriter');
  await copyDir(ROOT, buildRoot, EXCLUDES);

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
