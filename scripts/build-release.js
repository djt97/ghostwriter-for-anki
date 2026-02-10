const path = require('path');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');

const ALL_VARIANTS = ['full', 'lite'];
const selected = process.argv[2];
const variants = selected ? [selected] : ALL_VARIANTS;

const COMMON_EXCLUDES = [
  '.git',
  '.github',
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
  'scripts'
];

const LITE_REMOVALS = [
  'dashboard.html',
  'dashboard.js',
  'dashboard.css',
  'force-graph.js',
  'embeddings.js',
  'vendor/transformers',
  'vendor/onnx',
  'vendor/embeddings.js',
  'vendor/knn-index.js',
  'vendor/edge-labeler.js',
  'vendor/importmap.json'
];

const LITE_RESOURCE_REMOVALS = new Set([
  'vendor/*.js',
  'vendor/*.wasm',
  'vendor/*.json',
  'vendor/*.onnx',
  'vendor/transformers/*',
  'vendor/onnx/*',
  'embeddings.js'
]);

const LITE_CONNECT_SRC_REMOVALS = new Set([
  'https://huggingface.co',
  'https://cdn-lfs.huggingface.co',
  'https://cdn-lfs.hf.co'
]);

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

async function removeLiteFiles(liteRoot) {
  await Promise.all(LITE_REMOVALS.map(async (relPath) => {
    const target = path.join(liteRoot, relPath);
    await fs.rm(target, { recursive: true, force: true });
  }));
}

function updateCspConnectSrc(csp) {
  if (!csp) return csp;
  const directives = csp.split(';').map((part) => part.trim()).filter(Boolean);
  const updated = directives.map((directive) => {
    if (!directive.startsWith('connect-src ')) {
      return directive;
    }
    const tokens = directive.split(/\s+/);
    const prefix = tokens.shift();
    const filtered = tokens.filter((token) => !LITE_CONNECT_SRC_REMOVALS.has(token));
    return [prefix, ...filtered].join(' ');
  });
  return updated.join('; ');
}

async function updateLiteManifest(liteRoot) {
  const manifestPath = path.join(liteRoot, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  if (Array.isArray(manifest.web_accessible_resources)) {
    manifest.web_accessible_resources = manifest.web_accessible_resources.map((entry) => {
      const resources = Array.isArray(entry.resources) ? entry.resources : [];
      return {
        ...entry,
        resources: resources.filter((resource) => !LITE_RESOURCE_REMOVALS.has(resource))
      };
    });
  }

  if (manifest.content_security_policy?.extension_pages) {
    manifest.content_security_policy.extension_pages = updateCspConnectSrc(
      manifest.content_security_policy.extension_pages
    );
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function updateLitePanelConfig(liteRoot) {
  const panelPath = path.join(liteRoot, 'panel.js');
  const raw = await fs.readFile(panelPath, 'utf8');
  const updated = raw.replace('enableDashboard: true', 'enableDashboard: false');
  if (raw === updated) {
    throw new Error('Unable to disable dashboard in lite build (panel.js unchanged).');
  }
  await fs.writeFile(panelPath, updated);
}

async function updateLitePanelHtml(liteRoot) {
  const panelPath = path.join(liteRoot, 'panel.html');
  const raw = await fs.readFile(panelPath, 'utf8');
  const updated = raw.replace(
    /<!-- LITE-REMOVE-START -->[\s\S]*?<!-- LITE-REMOVE-END -->\s*/g,
    ''
  );
  if (raw === updated) {
    throw new Error('Unable to strip dashboard button container (panel.html unchanged).');
  }
  await fs.writeFile(panelPath, updated);
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

async function zipVariant(variant, variantRoot) {
  const zipName = `ghostwriter-${variant}.zip`;
  const zipPath = path.join(DIST_DIR, zipName);
  if (existsSync(zipPath)) {
    await fs.rm(zipPath, { force: true });
  }
  execSync(`zip -r "${zipPath}" .`, { cwd: variantRoot, stdio: 'inherit' });
}

async function buildVariant(variant) {
  if (!ALL_VARIANTS.includes(variant)) {
    throw new Error(`Unknown variant: ${variant}`);
  }

  const variantRoot = path.join(DIST_DIR, variant);
  await copyDir(ROOT, variantRoot, COMMON_EXCLUDES);

  if (variant === 'lite') {
    await removeLiteFiles(variantRoot);
    await updateLiteManifest(variantRoot);
    await updateLitePanelConfig(variantRoot);
    await updateLitePanelHtml(variantRoot);
  }

  await zipVariant(variant, variantRoot);
}

async function main() {
  buildMathJaxBundle();
  await prepareDist();
  for (const variant of variants) {
    await buildVariant(variant);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
