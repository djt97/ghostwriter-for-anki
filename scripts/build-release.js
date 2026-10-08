const path = require('path');
const fs = require('fs/promises');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Only reviewed extension resources belong in a release. New files (including tracked
// plans, transcripts and working assets) stay out until this list is explicitly updated.
const RELEASE_SOURCE_FILES = [
  'manifest.json',
  'LICENSE',
  'background.js',
  'content.js',
  'panel.html',
  'panel.js',
  'panel-markdown.js',
  'panel-ai-templates.js',
  'copilot-core.js',
  'defaults.js',
  'prompts.js',
  'shortcuts.js',
  'anki-connect.js',
  'anki-note.js',
  'stage2-migration.js',
  'options.html',
  'options.js',
  'options.css',
  'native-ai.js',
  'native-ai-options.js',
  'metadata-fallback.js',
  'mathjax-sandbox.html',
  'mathjax-sandbox.js',
  'privacy.md',
  'PRIVACY_POLICY.md',
  'THIRD_PARTY_NOTICES.md',
  'APACHE-2.0.txt',
  'icons/icon16.png',
  'icons/icon19.png',
  'icons/icon32.png',
  'icons/icon38.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'icons/ghost-card.svg',
  'icons/ghostwriter_small_promo_tile_440x280.png',
  'libs/markdown-it.min.js',
  'libs/mathjax/fonts/tex/MathJax_AMS-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Calligraphic-Bold.woff',
  'libs/mathjax/fonts/tex/MathJax_Calligraphic-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Fraktur-Bold.woff',
  'libs/mathjax/fonts/tex/MathJax_Fraktur-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Main-Bold.woff',
  'libs/mathjax/fonts/tex/MathJax_Main-Italic.woff',
  'libs/mathjax/fonts/tex/MathJax_Main-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Math-BoldItalic.woff',
  'libs/mathjax/fonts/tex/MathJax_Math-Italic.woff',
  'libs/mathjax/fonts/tex/MathJax_Math-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_SansSerif-Bold.woff',
  'libs/mathjax/fonts/tex/MathJax_SansSerif-Italic.woff',
  'libs/mathjax/fonts/tex/MathJax_SansSerif-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Script-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Size1-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Size2-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Size3-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Size4-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Typewriter-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Vector-Bold.woff',
  'libs/mathjax/fonts/tex/MathJax_Vector-Regular.woff',
  'libs/mathjax/fonts/tex/MathJax_Zero.woff'
];

// Webpack creates these files; no other untracked file is a release input.
const GENERATED_RELEASE_FILES = [
  'libs/mathjax/mathjax-bundle.js',
  'libs/mathjax/mathjax-bundle.js.LICENSE.txt'
];
const REQUIRED_RELEASE_FILES = [...RELEASE_SOURCE_FILES, ...GENERATED_RELEASE_FILES];

async function copyReleaseFiles(sourceRoot, buildRoot) {
  const trackedFiles = new Set(execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: sourceRoot,
    encoding: 'utf8'
  }).split('\0').filter(Boolean));
  const untracked = RELEASE_SOURCE_FILES.filter((relPath) => !trackedFiles.has(relPath));
  if (untracked.length) {
    throw new Error(`Release source files must be git tracked: ${untracked.join(', ')}`);
  }

  // Check inputs before copying so missing files and symlinks cannot produce a release.
  const checkedDirectories = new Set();
  for (const relPath of REQUIRED_RELEASE_FILES) {
    const directories = relPath.split('/').slice(0, -1);
    for (let i = 1; i <= directories.length; i++) {
      const dir = directories.slice(0, i).join('/');
      if (checkedDirectories.has(dir)) continue;
      const stat = await fs.lstat(path.join(sourceRoot, dir));
      if (!stat.isDirectory()) {
        throw new Error(`Release input directory must be a real directory: ${dir}`);
      }
      checkedDirectories.add(dir);
    }
    const stat = await fs.lstat(path.join(sourceRoot, relPath));
    if (!stat.isFile()) {
      throw new Error(`Release input must be a regular file: ${relPath}`);
    }
  }
  for (const relPath of REQUIRED_RELEASE_FILES) {
    const destPath = path.join(buildRoot, relPath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(path.join(sourceRoot, relPath), destPath);
  }
}

async function hardenReleaseBuild(buildRoot, { keepTestHooks = false } = {}) {
  const marker = 'const QF_TEST_MODE = /\\b__qf_ci\\b/i.test(location.search + location.hash);';
  const sources = [];
  // Both page-driven content hooks and panel fake-Anki responses must be disabled.
  // Validate both markers even for CI, so a renamed test mode cannot silently ship.
  for (const relPath of ['content.js', 'panel.js']) {
    const src = await fs.readFile(path.join(buildRoot, relPath), 'utf8');
    if (src.split(marker).length !== 2) {
      throw new Error(`build-release: expected one QF_TEST_MODE marker in ${relPath}; update scripts/build-release.js so release test hooks stay disabled.`);
    }
    sources.push({ relPath, src });
  }
  if (keepTestHooks) {
    console.log('build-release: GHOSTWRITER_BUILD_TEST_HOOKS=1 — test hooks kept (CI build, do not ship)');
    return;
  }
  for (const { relPath, src } of sources) {
    const patched = src.replace(marker, 'const QF_TEST_MODE = false; // test hooks disabled in release build');
    await fs.writeFile(path.join(buildRoot, relPath), patched);
  }
}

async function assertReleaseContents(buildRoot) {
  const expected = new Set(REQUIRED_RELEASE_FILES);
  const allowedDirectories = new Set();
  for (const relPath of expected) {
    let dir = path.posix.dirname(relPath);
    while (dir !== '.') {
      allowedDirectories.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  const found = new Set();
  const unexpected = [];
  async function inspect(dir, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory() && allowedDirectories.has(relPath)) {
        await inspect(path.join(dir, entry.name), relPath);
      } else if (entry.isFile() && expected.has(relPath)) {
        found.add(relPath);
      } else {
        unexpected.push(relPath);
      }
    }
  }
  await inspect(buildRoot);
  const missing = REQUIRED_RELEASE_FILES.filter((relPath) => !found.has(relPath));
  if (missing.length || unexpected.length) {
    throw new Error([
      'Release contents check failed.',
      missing.length ? `Missing required files: ${missing.join(', ')}` : '',
      unexpected.length ? `Unexpected paths: ${unexpected.join(', ')}` : ''
    ].filter(Boolean).join(' '));
  }
}

async function createReleaseArchive(buildRoot, zipPath) {
  await assertReleaseContents(buildRoot);
  await fs.rm(zipPath, { force: true });
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: buildRoot, stdio: 'inherit' });
}

async function build({
  sourceRoot = ROOT,
  distDir = path.join(sourceRoot, 'dist'),
  // CI explicitly opts in to exercise the same built artifact via test hooks.
  keepTestHooks = process.env.GHOSTWRITER_BUILD_TEST_HOOKS === '1'
} = {}) {
  await fs.rm(distDir, { recursive: true, force: true });
  const buildRoot = path.join(distDir, 'ghostwriter');
  await copyReleaseFiles(sourceRoot, buildRoot);
  await hardenReleaseBuild(buildRoot, { keepTestHooks });
  const zipPath = path.join(distDir, 'ghostwriter.zip');
  await createReleaseArchive(buildRoot, zipPath);
  return { buildRoot, zipPath };
}

async function main() {
  // Use the installed webpack directly; a release build must not fetch a missing tool.
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules/webpack/bin/webpack.js')], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  await build();
}

module.exports = {
  RELEASE_SOURCE_FILES,
  GENERATED_RELEASE_FILES,
  REQUIRED_RELEASE_FILES,
  copyReleaseFiles,
  hardenReleaseBuild,
  assertReleaseContents,
  createReleaseArchive,
  build
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
