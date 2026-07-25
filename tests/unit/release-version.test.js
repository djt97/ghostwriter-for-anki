const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

describe('release version metadata', () => {
  it('keeps the 0.5.0 manifest, package metadata, lockfile, and README in sync', () => {
    const expectedVersion = '0.5.0';
    const manifest = readJson('manifest.json');
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

    assert.equal(manifest.version, expectedVersion, 'manifest.json is the release source of truth');
    assert.equal(packageJson.version, expectedVersion);
    assert.equal(packageLock.version, expectedVersion);
    assert.equal(packageLock.packages[''].version, expectedVersion);
    const readmeVersion = readme.match(/^\*\*Current Version:\*\* `([^`]+)`$/m)?.[1];
    assert.equal(readmeVersion, expectedVersion);
  });
});
