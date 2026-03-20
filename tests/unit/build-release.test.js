const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// The build script isn't structured as a module, so we extract the pure
// functions by reading and evaluating just the parts we need.
const buildScriptPath = path.resolve(__dirname, '../../scripts/build-release.js');
const buildScriptSource = fs.readFileSync(buildScriptPath, 'utf8');

// Extract pure function source and evaluate in isolation
function extractFunction(source, name) {
  const regex = new RegExp(`function ${name}\\b[\\s\\S]*?\\n\\}`);
  const match = source.match(regex);
  if (!match) throw new Error(`Could not extract function: ${name}`);
  return match[0];
}

// Extract constants we need
function extractConst(source, name) {
  const regex = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`);
  const match = source.match(regex);
  if (!match) throw new Error(`Could not extract const: ${name}`);
  return JSON.parse(match[1].replace(/'/g, '"'));
}

// Build isolated versions of the pure functions
const normalizePath = new Function('path', `
  ${extractFunction(buildScriptSource, 'normalizePath')}
  return normalizePath;
`)({ sep: '/' });

const isExcluded = new Function(`
  ${extractFunction(buildScriptSource, 'isExcluded')}
  return isExcluded;
`)();

// Extract CSP function with its dependency
const LITE_CONNECT_SRC_REMOVALS_RAW = buildScriptSource.match(
  /const LITE_CONNECT_SRC_REMOVALS = new Set\(\[([\s\S]*?)\]\)/
);
const liteConnectSrcItems = LITE_CONNECT_SRC_REMOVALS_RAW
  ? LITE_CONNECT_SRC_REMOVALS_RAW[1].match(/'[^']+'/g).map(s => s.slice(1, -1))
  : [];
const LITE_CONNECT_SRC_REMOVALS = new Set(liteConnectSrcItems);

const updateCspConnectSrc = new Function('LITE_CONNECT_SRC_REMOVALS', `
  ${extractFunction(buildScriptSource, 'updateCspConnectSrc')}
  return updateCspConnectSrc;
`)(LITE_CONNECT_SRC_REMOVALS);

describe('build-release.js pure functions', () => {
  describe('normalizePath', () => {
    it('returns path unchanged on posix', () => {
      assert.equal(normalizePath('src/foo/bar'), 'src/foo/bar');
    });

    it('handles empty string', () => {
      assert.equal(normalizePath(''), '');
    });

    it('handles single filename', () => {
      assert.equal(normalizePath('file.js'), 'file.js');
    });
  });

  describe('isExcluded', () => {
    const excludes = ['.git', 'node_modules', 'tests', 'dist'];

    it('returns true for exact match', () => {
      assert.ok(isExcluded('.git', excludes));
      assert.ok(isExcluded('tests', excludes));
    });

    it('returns true for path under excluded dir', () => {
      assert.ok(isExcluded('node_modules/foo/bar.js', excludes));
      assert.ok(isExcluded('.git/config', excludes));
    });

    it('returns false for non-excluded paths', () => {
      assert.ok(!isExcluded('panel.js', excludes));
      assert.ok(!isExcluded('background.js', excludes));
    });

    it('returns false for partial name matches', () => {
      assert.ok(!isExcluded('.github', excludes));
      assert.ok(!isExcluded('testing', excludes));
    });

    it('handles empty excludes', () => {
      assert.ok(!isExcluded('anything', []));
    });
  });

  describe('COMMON_EXCLUDES', () => {
    let COMMON_EXCLUDES;

    before(() => {
      // Extract from the build script
      const match = buildScriptSource.match(
        /const COMMON_EXCLUDES = \[([\s\S]*?)\];/
      );
      assert.ok(match, 'Could not find COMMON_EXCLUDES');
      COMMON_EXCLUDES = match[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
    });

    it('excludes git and CI dirs', () => {
      assert.ok(COMMON_EXCLUDES.includes('.git'));
      assert.ok(COMMON_EXCLUDES.includes('.github'));
    });

    it('excludes dev-only files', () => {
      assert.ok(COMMON_EXCLUDES.includes('node_modules'));
      assert.ok(COMMON_EXCLUDES.includes('tests'));
      assert.ok(COMMON_EXCLUDES.includes('package.json'));
    });

    it('excludes dist to prevent nesting', () => {
      assert.ok(COMMON_EXCLUDES.includes('dist'));
    });

    it('excludes documentation files', () => {
      assert.ok(COMMON_EXCLUDES.includes('CLAUDE.md'));
      assert.ok(COMMON_EXCLUDES.includes('LISTING.md'));
    });
  });

  describe('updateCspConnectSrc', () => {
    const fullCsp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; " +
      "connect-src 'self' blob: data: http://127.0.0.1:* http://localhost:* " +
      "https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs.hf.co " +
      "https://smart.ultimateai.org https://api.openai.com https://generativelanguage.googleapis.com";

    it('removes HuggingFace URLs from connect-src', () => {
      const result = updateCspConnectSrc(fullCsp);
      assert.ok(!result.includes('https://huggingface.co'));
      assert.ok(!result.includes('https://cdn-lfs.huggingface.co'));
      assert.ok(!result.includes('https://cdn-lfs.hf.co'));
    });

    it('preserves non-HuggingFace URLs', () => {
      const result = updateCspConnectSrc(fullCsp);
      assert.ok(result.includes("'self'"));
      assert.ok(result.includes('https://api.openai.com'));
      assert.ok(result.includes('https://smart.ultimateai.org'));
    });

    it('preserves non-connect-src directives', () => {
      const result = updateCspConnectSrc(fullCsp);
      assert.ok(result.includes("script-src 'self' 'wasm-unsafe-eval'"));
      assert.ok(result.includes("object-src 'self'"));
    });

    it('handles null/undefined input', () => {
      assert.equal(updateCspConnectSrc(null), null);
      assert.equal(updateCspConnectSrc(undefined), undefined);
    });

    it('handles CSP with no connect-src', () => {
      const csp = "script-src 'self'; object-src 'self'";
      const result = updateCspConnectSrc(csp);
      assert.equal(result, csp);
    });
  });
});
