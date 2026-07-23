const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelPath = path.resolve(__dirname, '../../panel.js');
const panelSource = fs.readFileSync(panelPath, 'utf8');
const panelHtml = fs.readFileSync(path.resolve(__dirname, '../../panel.html'), 'utf8');
const backgroundSource = fs.readFileSync(path.resolve(__dirname, '../../background.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../../options.html'), 'utf8');

function extractFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  if (functionStart < 0) throw new Error(`Missing function ${name}`);
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const openingParen = source.indexOf('(', start);
  let parenDepth = 0;
  let closingParen = -1;
  for (let i = openingParen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    if (source[i] === ')') parenDepth -= 1;
    if (parenDepth === 0) {
      closingParen = i;
      break;
    }
  }
  const brace = source.indexOf('{', closingParen);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unbalanced function ${name}`);
}

function loadRouteResolver() {
  return new Function(`
    ${extractFunction(panelSource, 'normalizeProvider')}
    ${extractFunction(panelSource, 'inferProviderFromOptions')}
    ${extractFunction(panelSource, 'hasProviderApiKey')}
    ${extractFunction(panelSource, 'resolveModelBackend')}
    return resolveModelBackend;
  `)();
}

function loadNativeRouteExecutor({ runNativeModelTask, isAbortError, reportNativeHostedFallback }) {
  return new Function(
    'runNativeModelTask',
    'isAbortError',
    'reportNativeHostedFallback',
    `${extractFunction(panelSource, 'runNativeBackendWithFallback')}
     return runNativeBackendWithFallback;`
  )(runNativeModelTask, isAbortError, reportNativeHostedFallback);
}

describe('panel model backend routing', () => {
  it('keeps the explicitly selected configured provider ahead of Chrome AI', () => {
    const resolveModelBackend = loadRouteResolver();
    const fixtures = [
      ['openai', 'openaiKey'],
      ['openrouter', 'openrouterKey'],
      ['ultimate', 'ultimateKey'],
      ['gemini', 'geminiKey'],
      ['claude', 'claudeKey'],
    ];

    for (const [provider, key] of fixtures) {
      assert.deepEqual(
        resolveModelBackend({ llmProvider: provider, [key]: 'personal-key', nativeAiEnabled: true }),
        { backend: provider, selectedProvider: provider, hostedFallback: false }
      );
    }
  });

  it('always preserves an explicitly selected local model ahead of other fallbacks', () => {
    const resolveModelBackend = loadRouteResolver();
    assert.deepEqual(
      resolveModelBackend({ llmProvider: 'local', nativeAiEnabled: true }),
      { backend: 'local', selectedProvider: 'local', hostedFallback: false }
    );
  });

  it('uses opted-in Chrome AI before the included hosted model', () => {
    const resolveModelBackend = loadRouteResolver();
    assert.deepEqual(
      resolveModelBackend({ llmProvider: 'openai', nativeAiEnabled: true, nativeAiHostedFallback: true }),
      { backend: 'native', selectedProvider: 'openai', hostedFallback: true }
    );
  });

  it('honors a no-hosted-fallback choice when Chrome AI is enabled', () => {
    const resolveModelBackend = loadRouteResolver();
    assert.deepEqual(
      resolveModelBackend({ llmProvider: 'openai', nativeAiEnabled: true, nativeAiHostedFallback: false }),
      { backend: 'native', selectedProvider: 'openai', hostedFallback: false }
    );
  });

  it('never falls through after native failure when hosted fallback is disabled', async () => {
    let fallbackReports = 0;
    const nativeError = new Error('native unavailable');
    const execute = loadNativeRouteExecutor({
      runNativeModelTask: async () => { throw nativeError; },
      isAbortError: () => false,
      reportNativeHostedFallback: () => { fallbackReports += 1; },
    });

    await assert.rejects(
      execute({ backend: 'native', hostedFallback: false }, 'front', {}),
      nativeError
    );
    assert.equal(fallbackReports, 0);
  });

  it('never falls through on cancellation, even when hosted fallback is enabled', async () => {
    let fallbackReports = 0;
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const execute = loadNativeRouteExecutor({
      runNativeModelTask: async () => { throw abortError; },
      isAbortError: (error) => error?.name === 'AbortError',
      reportNativeHostedFallback: () => { fallbackReports += 1; },
    });

    await assert.rejects(
      execute({ backend: 'native', hostedFallback: true }, 'front', {}),
      abortError
    );
    assert.equal(fallbackReports, 0);
  });

  it('treats a string signal reason as cancellation before considering hosted fallback', async () => {
    let fallbackReports = 0;
    const controller = new AbortController();
    controller.abort('ghostwriter-copilot-cancelled');
    const execute = loadNativeRouteExecutor({
      runNativeModelTask: async () => { throw controller.signal.reason; },
      isAbortError: () => false,
      reportNativeHostedFallback: () => { fallbackReports += 1; },
    });

    let caught;
    try {
      await execute(
        { backend: 'native', hostedFallback: true },
        'front',
        { signal: controller.signal }
      );
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, 'ghostwriter-copilot-cancelled');
    assert.equal(fallbackReports, 0);
  });

  it('requests the hosted path only after an ordinary native failure and explicit consent', async () => {
    let fallbackReports = 0;
    const execute = loadNativeRouteExecutor({
      runNativeModelTask: async () => { throw new Error('native unavailable'); },
      isAbortError: () => false,
      reportNativeHostedFallback: () => { fallbackReports += 1; },
    });

    const result = await execute({ backend: 'native', hostedFallback: true }, 'front', {});
    assert.deepEqual(result, { usedNative: false, forceFreeTier: true, value: null });
    assert.equal(fallbackReports, 1);
  });

  it('changes the persistent backend label before a native-to-hosted request is dispatched', () => {
    const backends = [];
    const notices = [];
    const reportNativeHostedFallback = new Function(
      'isAbortError',
      'setActiveModelBackend',
      'showCopilotNotice',
      `${extractFunction(panelSource, 'reportNativeHostedFallback')}
       return reportNativeHostedFallback;`
    )(
      () => false,
      (backend) => backends.push(backend),
      (message) => notices.push(message)
    );

    reportNativeHostedFallback(new Error('native unavailable'));

    assert.deepEqual(backends, ['free-tier']);
    assert.match(notices[0], /included hosted request/i);
  });

  it('treats invalid native structured output as a failure at the same privacy boundary', async () => {
    let fallbackReports = 0;
    const execute = loadNativeRouteExecutor({
      runNativeModelTask: async () => 'not-json',
      isAbortError: () => false,
      reportNativeHostedFallback: () => { fallbackReports += 1; },
    });
    const parseOrThrow = () => { throw new Error('invalid structured response'); };

    const fallback = await execute(
      { backend: 'native', hostedFallback: true },
      'tags',
      {},
      parseOrThrow
    );
    assert.deepEqual(fallback, { usedNative: false, forceFreeTier: true, value: null });
    assert.equal(fallbackReports, 1);

    await assert.rejects(
      execute({ backend: 'native', hostedFallback: false }, 'tags', {}, parseOrThrow),
      /invalid structured response/
    );
    assert.equal(fallbackReports, 1);
  });

  it('retains included requests for the keyless default when Chrome AI is off', () => {
    const resolveModelBackend = loadRouteResolver();
    assert.deepEqual(
      resolveModelBackend({ llmProvider: 'openai', nativeAiEnabled: false }),
      { backend: 'free-tier', selectedProvider: 'openai', hostedFallback: false }
    );
  });

  it('does not silently replace an unconfigured explicit third-party provider', () => {
    const resolveModelBackend = loadRouteResolver();
    for (const provider of ['openrouter', 'gemini', 'claude']) {
      assert.deepEqual(
        resolveModelBackend({ llmProvider: provider, nativeAiEnabled: false }),
        { backend: 'missing', selectedProvider: provider, hostedFallback: false }
      );
    }
  });

  it('routes native Front, Back, and Cloze through the document API', () => {
    for (const kind of ['front', 'back', 'cloze']) {
      assert.match(panelSource, new RegExp(`runNativeBackendWithFallback\\(\\s*route,\\s*["']${kind}["']`));
    }
  });

  it('gives native tags and context strict task-specific schemas', () => {
    assert.match(panelSource, /nativeTask:\s*["']tags["']/);
    assert.match(panelSource, /nativeSchema:\s*TAG_SUGGESTION_SCHEMA/);
    assert.match(panelSource, /nativeTask:\s*["']context["']/);
    assert.match(panelSource, /nativeSchema:\s*CONTEXT_SUGGESTION_SCHEMA/);
    assert.match(panelSource, /domain:\s*\{\s*type:\s*["']string["'],\s*enum:\s*CONTROLLED_TAG_DOMAINS/);
  });

  it('keeps Claude structured JSON on Claude instead of the OpenAI-compatible path', () => {
    const body = extractFunction(panelSource, 'ultimateChatJSON');
    assert.match(body, /provider\s*===\s*["']claude["']/);
    assert.ok(body.indexOf('provider === "claude"') < body.indexOf('getOpenAIProviderConfig'));
  });

  it('loads the deterministic metadata fallback before the panel runtime', () => {
    assert.ok(panelHtml.indexOf('src="metadata-fallback.js"') >= 0);
    assert.ok(panelHtml.indexOf('src="metadata-fallback.js"') < panelHtml.indexOf('src="panel.js"'));
  });

  it('does not couple generated-card context to the auto-tag preference', () => {
    assert.doesNotMatch(panelSource, /wantAiContextForAICards\s*=\s*wantAutoContext\s*&&\s*wantAutoTag/);
  });

  it('has no service-worker JSON bypass around the provider router', () => {
    assert.doesNotMatch(backgroundSource, /quickflash:ultimateChatJSON/);
  });

  it('labels the model path as included hosted or on-device without calling it free', () => {
    assert.match(panelSource, /Included hosted model/);
    assert.match(panelSource, /Chrome on-device AI/);
    assert.doesNotMatch(panelSource, /Ghostwriter free suggestions/);
  });

  it('explains the Chrome AI fallback boundary and current language support', () => {
    assert.match(optionsHtml, /processed on this device/i);
    assert.match(optionsHtml, /English/i);
    assert.match(optionsHtml, /hosted fallback/i);
    assert.doesNotMatch(optionsHtml, /Optional, private model access/i);
  });

  it('routes AI tag output through the controlled taxonomy sanitizer', () => {
    assert.match(panelSource, /sanitizeAiSuggestedTags/);
    assert.match(panelSource, /classifyDomainTags/);
  });
});
