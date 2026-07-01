const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// The build script isn't structured as a module, so we extract the pure
// functions by reading and evaluating just the parts we need.
const buildScriptPath = path.resolve(__dirname, '../../scripts/build-release.js');
const buildScriptSource = fs.readFileSync(buildScriptPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../manifest.json'), 'utf8'));

// Extract pure function source and evaluate in isolation
function extractFunction(source, name) {
  const regex = new RegExp(`function ${name}\\b[\\s\\S]*?\\n\\}`);
  const match = source.match(regex);
  if (!match) throw new Error(`Could not extract function: ${name}`);
  return match[0];
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

function extractConstArray(name) {
  const match = buildScriptSource.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `Could not find ${name}`);
  return match[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
}

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

  describe('EXCLUDES', () => {
    let EXCLUDES;

    before(() => {
      const match = buildScriptSource.match(
        /const EXCLUDES = \[([\s\S]*?)\];/
      );
      assert.ok(match, 'Could not find EXCLUDES');
      EXCLUDES = match[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
    });

    it('excludes git and CI dirs', () => {
      assert.ok(EXCLUDES.includes('.git'));
      assert.ok(EXCLUDES.includes('.github'));
    });

    it('excludes dev-only files', () => {
      assert.ok(EXCLUDES.includes('node_modules'));
      assert.ok(EXCLUDES.includes('tests'));
      assert.ok(EXCLUDES.includes('test-results'));
      assert.ok(EXCLUDES.includes('playwright-report'));
      assert.ok(EXCLUDES.includes('package.json'));
      assert.ok(EXCLUDES.includes('eslint.config.js'));
      assert.ok(EXCLUDES.includes('AGENTS.md'));
      assert.ok(EXCLUDES.includes('.DS_Store'));
      assert.ok(EXCLUDES.includes('.gitignore'));
      assert.ok(EXCLUDES.includes('stubs'));
      assert.ok(EXCLUDES.includes('vendor'));
    });

    it('excludes dist to prevent nesting', () => {
      assert.ok(EXCLUDES.includes('dist'));
    });

    it('excludes documentation and plan files', () => {
      assert.ok(EXCLUDES.includes('CLAUDE.md'));
      assert.ok(EXCLUDES.includes('LISTING.md'));
      assert.ok(EXCLUDES.includes('GHOSTWRITER_V2_PLAN.md'));
    });

    it('excludes stale licence files for removed features', () => {
      assert.ok(EXCLUDES.includes('licences'));
    });
  });

  describe('release contents contract', () => {
    const required = extractConstArray('REQUIRED_RELEASE_FILES');
    const forbidden = extractConstArray('FORBIDDEN_RELEASE_PATHS');

    it('requires release-facing privacy and notice files', () => {
      for (const relPath of [
        'privacy.md',
        'PRIVACY_POLICY.md',
        'THIRD_PARTY_NOTICES.md',
        'APACHE-2.0.txt',
        'libs/markdown-it.min.js',
        'libs/mathjax/mathjax-bundle.js.LICENSE.txt',
      ]) {
        assert.ok(required.includes(relPath), `missing required release file: ${relPath}`);
        assert.ok(fs.existsSync(path.resolve(__dirname, '../..', relPath)), `source missing: ${relPath}`);
      }
    });

    it('keeps development-only and stale license paths out of the release', () => {
      for (const relPath of [
        'node_modules',
        'tests',
        'docs',
        'scripts',
        'package.json',
        'package-lock.json',
        'licences',
      ]) {
        assert.ok(forbidden.includes(relPath), `missing forbidden release path: ${relPath}`);
        assert.ok(isExcluded(relPath, forbidden));
      }
    });

    it('does not exclude files required by the release contents check', () => {
      for (const relPath of required) {
        assert.equal(isExcluded(relPath, forbidden), false, `required file is forbidden: ${relPath}`);
      }
    });
  });
});

describe('manifest shortcuts', () => {
  it('declares the MathJax preview page as a Chrome sandboxed page', () => {
    assert.ok(manifest.sandbox?.pages?.includes('mathjax-sandbox.html'));
    assert.ok(manifest.content_security_policy?.sandbox?.includes('sandbox allow-scripts'));
  });

  it('defaults the explicit overlay command to the overlay-first shortcut', () => {
    const overlayCommand = manifest.commands?.['open-ghostwriter-overlay'];
    assert.equal(overlayCommand?.description, 'Open Ghostwriter for Anki Overlay');
    assert.equal(overlayCommand?.suggested_key?.mac, 'Alt+Shift+F');
    assert.equal(overlayCommand?.suggested_key?.default, 'Ctrl+Shift+F');
  });

  it('keeps one visible side-panel toggle command with its own shortcut', () => {
    const sidePanelCommand = manifest.commands?.['open-ghostwriter-side-panel'];
    assert.equal(sidePanelCommand?.description, 'Toggle Ghostwriter for Anki Side Panel');
    assert.equal(sidePanelCommand?.suggested_key?.mac, 'Command+Shift+L');
    assert.equal(sidePanelCommand?.suggested_key?.default, 'Ctrl+Shift+L');
  });

  it('drops stale duplicate and tuning commands from the manifest', () => {
    assert.equal(manifest.commands?._execute_action, undefined);
    assert.equal(manifest.commands?.['open-ghostwriter'], undefined);
    assert.equal(manifest.commands?.['open-ghostwriter-with-selection'], undefined);
    assert.equal(manifest.commands?.['quickflash-toggle-source-mode'], undefined);
  });
});
