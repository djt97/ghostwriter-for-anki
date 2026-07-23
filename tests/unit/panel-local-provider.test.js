const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelSource = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');
const optionsSource = fs.readFileSync(path.resolve(__dirname, '../../options.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../../options.html'), 'utf8');

// Extract getOpenAIProviderConfig from panel.js and run it against local opts. It depends only on
// normalizeProvider, inferProviderFromOptions, and a few string constants, so we can bundle those.
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`Could not find function: ${name}`);
  const bodyStart = source.indexOf('{', source.indexOf('(', start));
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract function: ${name}`);
}

const getOpenAIProviderConfig = new Function(`
  const LOCAL_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
  const LOCAL_DEFAULT_MODEL = "llama3.2";
  const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
  const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
  const ULTIMATE_BASE_URL = "https://api.ultimateai.org/v1";
  const ULTIMATE_DEFAULT_MODEL = "auto";
  const ULTIMATE_HOST_RE = /^https:\\/\\/(?:api|smart|chat)\\.ultimateai\\.org$/i;
  ${extractFunction(panelSource, 'normalizeProvider')}
  ${extractFunction(panelSource, 'inferProviderFromOptions')}
  ${extractFunction(panelSource, 'normalizeUltimateBaseUrl')}
  ${extractFunction(panelSource, 'getOpenAIProviderConfig')}
  return getOpenAIProviderConfig;
`)();

describe('panel.js local provider', () => {
  it('resolves a keyless localhost config', () => {
    const config = getOpenAIProviderConfig({ llmProvider: 'local' });
    assert.equal(config.provider, 'local');
    assert.equal(config.apiKey, '');
    assert.equal(config.baseUrl, 'http://127.0.0.1:11434/v1');
    assert.equal(config.model, 'llama3.2');
  });

  it('honors a custom local base URL and model and strips trailing slashes', () => {
    const config = getOpenAIProviderConfig({
      llmProvider: 'local',
      localBaseUrl: 'http://localhost:1234/v1///',
      localModel: 'gemma3:4b',
    });
    assert.equal(config.baseUrl, 'http://localhost:1234/v1');
    assert.equal(config.model, 'gemma3:4b');
  });

  it('never diverts a keyless local provider to the hosted free-tier proxy', () => {
    assert.match(panelSource, /if \(provider === "local"\) return true;/);
    assert.match(
      panelSource,
      /if \(hasProviderApiKey\(opts, selectedProvider\)\) \{\s*return \{ backend: selectedProvider, selectedProvider, hostedFallback: false \}/
    );
  });

  it('does not throw "no key" errors on the local path', () => {
    assert.ok(panelSource.includes('!apiKey && providerName !== "local"'));
    assert.ok(panelSource.includes('!apiKey && provider !== "local"'));
  });
});

describe('options.js local provider wiring', () => {
  it('registers a local preset with defaults, models, and CORS help', () => {
    assert.match(optionsSource, /local:\s*\{[\s\S]*?baseUrl:\s*"http:\/\/127\.0\.0\.1:11434\/v1"/);
    assert.match(optionsSource, /local:\s*\[[\s\S]*?llama3\.2/); // KNOWN_MODELS.local
    assert.ok(optionsSource.includes('OLLAMA_ORIGINS=chrome-extension://*'));
    assert.ok(optionsSource.includes('localKey')); // persisted + treated as a secret
  });

  it('maps local host permissions to localhost, not UltimateAI', () => {
    assert.match(optionsSource, /local:\s*\["http:\/\/127\.0\.0\.1\/\*",\s*"http:\/\/localhost\/\*"\]/);
  });

  it('offers the local provider in the options UI', () => {
    assert.match(optionsHtml, /<option value="local">/);
  });
});
