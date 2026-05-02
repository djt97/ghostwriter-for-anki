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
});

describe('manifest shortcuts', () => {
  it('defaults the explicit overlay command to the overlay-first shortcut', () => {
    const overlayCommand = manifest.commands?.['open-ghostwriter-overlay'];
    assert.equal(overlayCommand?.description, 'Open Ghostwriter for Anki Overlay');
    assert.equal(overlayCommand?.suggested_key?.mac, 'Option+Shift+F');
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
