const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sandboxSource = fs.readFileSync(
  path.resolve(__dirname, '../../mathjax-sandbox.js'),
  'utf8'
);
const panelSource = fs.readFileSync(
  path.resolve(__dirname, '../../panel.js'),
  'utf8'
);

describe('MathJax sandbox messaging', () => {
  it('only accepts preview messages from the trusted parent and channel', () => {
    assert.ok(sandboxSource.includes('function getExtensionOrigin()'));
    assert.ok(sandboxSource.includes("getSearchParam('parentOrigin')"));
    assert.ok(sandboxSource.includes("getSearchParam('channel')"));
    assert.ok(sandboxSource.includes('const TRUSTED_PARENT_ORIGIN = getTrustedParentOrigin() || getExtensionOrigin()'));
    assert.ok(sandboxSource.includes('const MESSAGE_CHANNEL = getMessageChannel()'));
    assert.ok(sandboxSource.includes('function isTrustedParentMessage(event)'));
    assert.ok(sandboxSource.includes('event.source && event.source !== window.parent'));
    assert.ok(sandboxSource.includes('data.channel !== MESSAGE_CHANNEL'));
    assert.ok(sandboxSource.includes('event.origin !== TRUSTED_PARENT_ORIGIN'));
    assert.ok(sandboxSource.includes('if (!isTrustedParentMessage(event)) return;'));
  });

  it('posts sandbox notifications back to the computed parent origin with the channel', () => {
    assert.ok(sandboxSource.includes('const PARENT_ORIGIN = TRUSTED_PARENT_ORIGIN ||'));
    assert.ok(sandboxSource.includes('Object.assign({ type, channel: MESSAGE_CHANNEL }'));
    assert.match(
      sandboxSource,
      /window\.parent\.postMessage\([\s\S]*?PARENT_ORIGIN[\s\S]*?\);/
    );
  });

  it('sends panel preview updates to the opaque sandbox origin with a channel token', () => {
    assert.ok(panelSource.includes('function getExtensionMessageOrigin()'));
    assert.ok(panelSource.includes('const SANDBOX_TARGET_ORIGIN = "*"'));
    assert.ok(panelSource.includes('function ensurePreviewFrameChannel(frame)'));
    assert.ok(panelSource.includes('function buildMathjaxSandboxUrl(frame)'));
    assert.ok(panelSource.includes('function postPreviewFrameMessage(frame, payload)'));
    assert.ok(panelSource.includes('postPreviewFrameMessage(frame, payload)'));
    assert.ok(panelSource.includes('postPreviewFrameMessage(frame, queued)'));
    assert.ok(panelSource.includes('url.searchParams.set("parentOrigin", parentOrigin)'));
    assert.ok(panelSource.includes('url.searchParams.set("channel", channel)'));
    assert.ok(panelSource.includes('{ ...payload, channel }'));
    assert.ok(panelSource.includes('SANDBOX_TARGET_ORIGIN'));
  });

  it('checks preview-ready messages against source frame and channel before trusting them', () => {
    const listenerBlock = panelSource.match(
      /window\.addEventListener\('message', \(event\) => \{[\s\S]*?function handleInput/
    );
    assert.ok(listenerBlock, 'Could not find inline preview message listener');
    assert.ok(listenerBlock[0].includes('isTrustedPreviewFrameMessage(iframeFor(field), data)'));
    assert.ok(listenerBlock[0].includes("data.type === 'quickflash:previewReady'"));
    assert.ok(listenerBlock[0].includes("data.type === 'quickflash:previewError'"));
  });
});
