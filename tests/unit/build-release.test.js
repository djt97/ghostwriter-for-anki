const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { readFileSync, existsSync } = require('fs');
const { execFileSync } = require('child_process');
const vm = require('vm');
const {
  RELEASE_SOURCE_FILES,
  GENERATED_RELEASE_FILES,
  REQUIRED_RELEASE_FILES,
  copyReleaseFiles,
  hardenReleaseBuild,
  assertReleaseContents,
  createReleaseArchive,
  build
} = require('../../scripts/build-release.js');

const ROOT = path.resolve(__dirname, '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const TEST_MODE_MARKER = 'const QF_TEST_MODE = /\\b__qf_ci\\b/i.test(location.search + location.hash);';

async function fixture(t) {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ghostwriter-release-'));
  t.after(() => fs.rm(sourceRoot, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: sourceRoot });
  for (const relPath of REQUIRED_RELEASE_FILES) {
    const filePath = path.join(sourceRoot, relPath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const content = ['content.js', 'panel.js'].includes(relPath)
      ? await fs.readFile(path.join(ROOT, relPath), 'utf8')
      : `fixture: ${relPath}\n`;
    await fs.writeFile(filePath, content);
  }
  execFileSync('git', ['add', '--', ...RELEASE_SOURCE_FILES], { cwd: sourceRoot });
  return { sourceRoot, buildRoot: path.join(sourceRoot, 'dist', 'ghostwriter') };
}

function archiveFiles(zipPath) {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .trim().split('\n').filter((name) => !name.endsWith('/')).sort();
}

function testModeValue(source, location) {
  const declaration = source.match(/^\s*const QF_TEST_MODE = .*$/m)?.[0];
  assert.ok(declaration, 'test mode declaration exists');
  return vm.runInNewContext(`${declaration}\nQF_TEST_MODE`, { location });
}

function panelAnki(source, request, permissionGranted = true) {
  const declaration = source.match(/^const QF_TEST_MODE = .*$/m)?.[0];
  const start = source.indexOf('async function anki(action, params = {}) {');
  const end = source.indexOf('\nfunction isMalformedJsonError', start);
  assert.ok(declaration && start >= 0 && end > start, 'real panel Anki function exists');
  return vm.runInNewContext(`${declaration}\n${source.slice(start, end)}\nanki`, {
    location: { search: '?__qf_ci=1', hash: '#__qf_ci' },
    ankiSessionCache: { permissionGranted, values: new Map() },
    sendAnkiConnectRequest: request,
    isCacheableAnkiAction: () => false,
    invalidatesAnkiSetupCache: () => false,
    clearAnkiSessionCache: () => {}
  });
}

describe('release resource contract', () => {
  it('contains only explicit, unique paths and keeps all notice files', () => {
    assert.equal(new Set(REQUIRED_RELEASE_FILES).size, REQUIRED_RELEASE_FILES.length);
    assert.deepEqual(GENERATED_RELEASE_FILES, [
      'libs/mathjax/mathjax-bundle.js',
      'libs/mathjax/mathjax-bundle.js.LICENSE.txt'
    ]);
    for (const relPath of REQUIRED_RELEASE_FILES) {
      assert.ok(existsSync(path.join(ROOT, relPath)), `source missing: ${relPath}`);
      assert.ok(!relPath.includes('*'), `allowlist must name exact files: ${relPath}`);
      assert.ok(!relPath.startsWith('.') && !relPath.startsWith('tests/'));
    }
    for (const relPath of ['LICENSE', 'privacy.md', 'PRIVACY_POLICY.md', 'THIRD_PARTY_NOTICES.md', 'APACHE-2.0.txt']) {
      assert.ok(RELEASE_SOURCE_FILES.includes(relPath), `missing notice: ${relPath}`);
    }
  });

  it('preserves every manifest entry point, icon and web-accessible resource', () => {
    const references = [
      manifest.background.service_worker,
      manifest.side_panel.default_path,
      manifest.options_page,
      ...manifest.sandbox.pages,
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
      ...manifest.web_accessible_resources.flatMap((entry) => entry.resources)
    ];
    for (const relPath of references) {
      if (relPath.endsWith('/*')) {
        const prefix = relPath.slice(0, -1);
        const actual = execFileSync('git', ['ls-files', '-z', '--', prefix], { cwd: ROOT, encoding: 'utf8' })
          .split('\0').filter(Boolean);
        assert.ok(actual.length, `glob resolves resources: ${relPath}`);
        for (const file of actual) assert.ok(REQUIRED_RELEASE_FILES.includes(file), `missing manifest resource: ${file}`);
      } else {
        assert.ok(REQUIRED_RELEASE_FILES.includes(relPath), `missing manifest resource: ${relPath}`);
      }
    }
  });

  it('preserves local scripts and styles referenced by every release HTML page', () => {
    for (const relPath of RELEASE_SOURCE_FILES.filter((file) => file.endsWith('.html'))) {
      const html = readFileSync(path.join(ROOT, relPath), 'utf8');
      const references = Array.from(html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi), (match) => match[1]);
      assert.ok(references.length, `HTML references checked: ${relPath}`);
      for (const reference of references) {
        assert.ok(REQUIRED_RELEASE_FILES.includes(reference), `${relPath} needs ${reference}`);
      }
    }
  });

  it('keeps the migration worker dependency and excludes the retired review pages', () => {
    const source = readFileSync(path.join(ROOT, 'background.js'), 'utf8');
    const imports = Array.from(source.matchAll(/importScripts\(["']([^"']+)["']\)/g), (match) => match[1]);
    assert.ok(imports.includes('stage2-migration.js'));
    for (const resource of imports) assert.ok(REQUIRED_RELEASE_FILES.includes(resource), `worker needs ${resource}`);
    assert.equal(REQUIRED_RELEASE_FILES.includes('review.html'), false);
    assert.equal(REQUIRED_RELEASE_FILES.includes('review.js'), false);
  });
});

describe('release input selection', () => {
  it('ignores tracked unknown files and untracked plans, transcripts, hidden tests and assets', async (t) => {
    const { sourceRoot, buildRoot } = await fixture(t);
    const unwanted = [
      'tracked-runtime.js', 'GHOSTWRITER_V3_PLAN.md', 'private-transcript.txt',
      '.tests/private.json', 'icons/local-note.txt', 'libs/mathjax/local-note.js',
      'new-root-file.json', 'demo.mp4'
    ];
    for (const relPath of unwanted) {
      await fs.mkdir(path.dirname(path.join(sourceRoot, relPath)), { recursive: true });
      await fs.writeFile(path.join(sourceRoot, relPath), 'private fixture');
    }
    execFileSync('git', ['add', '--', 'tracked-runtime.js', 'GHOSTWRITER_V3_PLAN.md'], { cwd: sourceRoot });
    await copyReleaseFiles(sourceRoot, buildRoot);
    await assertReleaseContents(buildRoot);
    for (const relPath of unwanted) assert.equal(existsSync(path.join(buildRoot, relPath)), false, relPath);
    // The generated bundle and notice are deliberately untracked in this fixture.
    for (const relPath of GENERATED_RELEASE_FILES) assert.ok(existsSync(path.join(buildRoot, relPath)), relPath);
  });

  for (const relPath of ['panel.js', 'icons/icon128.png']) {
    it(`rejects an untracked file even at an allowed path: ${relPath}`, async (t) => {
      const { sourceRoot, buildRoot } = await fixture(t);
      execFileSync('git', ['rm', '--cached', '--quiet', '--', relPath], { cwd: sourceRoot });
      await assert.rejects(copyReleaseFiles(sourceRoot, buildRoot), /must be git tracked/);
      assert.equal(existsSync(buildRoot), false);
    });
  }

  for (const relPath of ['options.css', 'libs/mathjax/mathjax-bundle.js']) {
    it(`fails closed when a required input is missing: ${relPath}`, async (t) => {
      const { sourceRoot, buildRoot } = await fixture(t);
      await fs.rm(path.join(sourceRoot, relPath));
      await assert.rejects(copyReleaseFiles(sourceRoot, buildRoot), { code: 'ENOENT' });
      assert.equal(existsSync(buildRoot), false);
    });
  }

  it('rejects a symlink at an allowed source path', async (t) => {
    const { sourceRoot, buildRoot } = await fixture(t);
    await fs.rm(path.join(sourceRoot, 'panel.js'));
    await fs.symlink(path.join(sourceRoot, 'content.js'), path.join(sourceRoot, 'panel.js'));
    await assert.rejects(copyReleaseFiles(sourceRoot, buildRoot), /must be a regular file: panel.js/);
  });

  for (const dir of ['icons', 'libs/mathjax']) {
    it(`rejects a symlinked ancestor before copying resources: ${dir}`, async (t) => {
      const { sourceRoot, buildRoot } = await fixture(t);
      const target = path.join(sourceRoot, 'external-resources');
      await fs.rename(path.join(sourceRoot, dir), target);
      await fs.symlink(target, path.join(sourceRoot, dir));
      await assert.rejects(copyReleaseFiles(sourceRoot, buildRoot), /must be a real directory/);
      assert.equal(existsSync(buildRoot), false);
    });
  }
});

describe('production and explicit CI test hooks', () => {
  it('disables both modes for query and fragment flags without changing source files', async (t) => {
    const { sourceRoot, buildRoot } = await fixture(t);
    await copyReleaseFiles(sourceRoot, buildRoot);
    await hardenReleaseBuild(buildRoot);
    for (const relPath of ['content.js', 'panel.js']) {
      const src = await fs.readFile(path.join(sourceRoot, relPath), 'utf8');
      const built = await fs.readFile(path.join(buildRoot, relPath), 'utf8');
      assert.ok(src.includes(TEST_MODE_MARKER), `source unchanged: ${relPath}`);
      assert.ok(!built.includes(TEST_MODE_MARKER), `mode removed: ${relPath}`);
      for (const location of [{ search: '?__qf_ci=1', hash: '' }, { search: '', hash: '#__qf_ci' }]) {
        assert.equal(testModeValue(built, location), false, relPath);
      }
    }
  });

  it('production panel sends through the mocked Anki request instead of returning a fake success', async (t) => {
    const { sourceRoot, buildRoot } = await fixture(t);
    await copyReleaseFiles(sourceRoot, buildRoot);
    await hardenReleaseBuild(buildRoot);
    const built = await fs.readFile(path.join(buildRoot, 'panel.js'), 'utf8');
    const calls = [];
    const anki = panelAnki(built, async (action) => { calls.push(action); return 987654; });
    assert.equal(await anki('addNote', { note: {} }), 987654);
    assert.deepEqual(calls, ['addNote']);
    const denied = new Error('mock permission denied');
    denied.kind = 'permission-denied';
    const permissionCalls = [];
    const deniedAnki = panelAnki(built, async (action) => { permissionCalls.push(action); throw denied; }, false);
    await assert.rejects(deniedAnki('addNote', { note: {} }), (err) => err === denied);
    assert.deepEqual(permissionCalls, ['requestPermission']);
  });

  it('keeps both query and fragment test modes only for an explicit CI build', async (t) => {
    const { sourceRoot, buildRoot } = await fixture(t);
    await copyReleaseFiles(sourceRoot, buildRoot);
    await hardenReleaseBuild(buildRoot, { keepTestHooks: true });
    for (const relPath of ['content.js', 'panel.js']) {
      const built = await fs.readFile(path.join(buildRoot, relPath), 'utf8');
      assert.equal(built, await fs.readFile(path.join(sourceRoot, relPath), 'utf8'));
      for (const location of [{ search: '?__qf_ci=1', hash: '' }, { search: '', hash: '#__qf_ci' }]) {
        assert.equal(testModeValue(built, location), true, relPath);
      }
    }
    const anki = panelAnki(await fs.readFile(path.join(buildRoot, 'panel.js'), 'utf8'), () => assert.fail('CI should use fixture Anki'));
    assert.equal(await anki('addNote', { note: {} }), 123456);
  });

  for (const relPath of ['content.js', 'panel.js']) {
    for (const keepTestHooks of [false, true]) {
      it(`fails closed for a changed marker in ${relPath} (CI=${keepTestHooks})`, async (t) => {
        const { sourceRoot, buildRoot } = await fixture(t);
        await copyReleaseFiles(sourceRoot, buildRoot);
        const file = path.join(buildRoot, relPath);
        await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace(TEST_MODE_MARKER, 'const QF_TEST_MODE = true;'));
        await assert.rejects(hardenReleaseBuild(buildRoot, { keepTestHooks }), new RegExp(`expected one QF_TEST_MODE marker in ${relPath}`));
      });
    }
  }
});

describe('release archive validation', () => {
  it('creates an archive containing exactly the explicit release files', async (t) => {
    const { sourceRoot } = await fixture(t);
    await fs.writeFile(path.join(sourceRoot, 'private-transcript.txt'), 'private fixture');
    const { buildRoot, zipPath } = await build({ sourceRoot, keepTestHooks: false });
    assert.deepEqual(archiveFiles(zipPath), [...REQUIRED_RELEASE_FILES].sort());
    await assertReleaseContents(buildRoot);
    const panel = execFileSync('unzip', ['-p', zipPath, 'panel.js'], { encoding: 'utf8' });
    assert.equal(testModeValue(panel, { search: '?__qf_ci=1', hash: '' }), false);
  });

  it('preserves test hooks in the archive for the explicit CI environment option', async (t) => {
    const { sourceRoot } = await fixture(t);
    const previous = process.env.GHOSTWRITER_BUILD_TEST_HOOKS;
    let zipPath;
    try {
      process.env.GHOSTWRITER_BUILD_TEST_HOOKS = '1';
      ({ zipPath } = await build({ sourceRoot }));
    } finally {
      if (previous === undefined) delete process.env.GHOSTWRITER_BUILD_TEST_HOOKS;
      else process.env.GHOSTWRITER_BUILD_TEST_HOOKS = previous;
    }
    assert.deepEqual(archiveFiles(zipPath), [...REQUIRED_RELEASE_FILES].sort());
    for (const relPath of ['content.js', 'panel.js']) {
      const source = execFileSync('unzip', ['-p', zipPath, relPath], { encoding: 'utf8' });
      assert.equal(testModeValue(source, { search: '?__qf_ci=1', hash: '' }), true, relPath);
    }
  });

  for (const relPath of ['new-root-file.txt', 'icons/private.txt', '.tests']) {
    it(`refuses to archive unexpected contents: ${relPath}`, async (t) => {
      const { sourceRoot, buildRoot } = await fixture(t);
      await copyReleaseFiles(sourceRoot, buildRoot);
      if (relPath === '.tests') await fs.mkdir(path.join(buildRoot, relPath));
      else await fs.writeFile(path.join(buildRoot, relPath), 'private fixture');
      const zipPath = path.join(sourceRoot, 'blocked.zip');
      await assert.rejects(createReleaseArchive(buildRoot, zipPath), /Unexpected paths:/);
      assert.equal(existsSync(zipPath), false);
    });
  }

  it('refuses to archive a missing required resource or a symlink', async (t) => {
    const { sourceRoot, buildRoot } = await fixture(t);
    await copyReleaseFiles(sourceRoot, buildRoot);
    await fs.rm(path.join(buildRoot, 'options.css'));
    const zipPath = path.join(sourceRoot, 'blocked.zip');
    await assert.rejects(createReleaseArchive(buildRoot, zipPath), /Missing required files: options.css/);
    await fs.symlink(path.join(buildRoot, 'panel.js'), path.join(buildRoot, 'options.css'));
    await assert.rejects(createReleaseArchive(buildRoot, zipPath), /Unexpected paths: options.css/);
    assert.equal(existsSync(zipPath), false);
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
