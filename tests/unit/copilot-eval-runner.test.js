const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const runnerSource = fs.readFileSync(
  path.resolve(__dirname, '../../scripts/run-copilot-eval.js'),
  'utf8'
);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`Could not find function: ${name}`);
  const paramsStart = source.indexOf('(', start);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsEnd = i;
        break;
      }
    }
  }
  if (paramsEnd === -1) throw new Error(`Could not parse parameters for: ${name}`);
  const bodyStart = source.indexOf('{', paramsEnd);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract function: ${name}`);
}

describe('Copilot eval runner', () => {
  it('documents UltimateAI credential sources and 401 guidance', () => {
    assert.ok(runnerSource.includes('ULTIMATE_API_KEY'));
    assert.ok(runnerSource.includes('ULTIMATEAI_API_KEY'));
    assert.ok(runnerSource.includes('https://api.ultimateai.org/v1'));
    assert.ok(runnerSource.includes('const ULTIMATE_DEFAULT_MODEL = "auto"'));
    assert.ok(runnerSource.includes('Chrome extension settings'));
    assert.ok(runnerSource.includes('Do not include a leading'));
  });

  it('can list provider models for debugging model ids', () => {
    assert.ok(runnerSource.includes('--list-models'));
    assert.ok(runnerSource.includes('async function listProviderModels'));
    assert.ok(runnerSource.includes('${config.baseUrl}/models'));
    assert.ok(runnerSource.includes('GEMINI_API_KEY'));
    assert.ok(runnerSource.includes('generateContent'));
  });

  it('records provider-reported model names in live reports', () => {
    assert.ok(runnerSource.includes('frontActualModel'));
    assert.ok(runnerSource.includes('backActualModel'));
    assert.ok(runnerSource.includes('Provider reported model(s)'));
    assert.ok(runnerSource.includes('Provider Reported Front Model'));
  });

  it('normalizes accidental Bearer prefixes before sending Authorization headers', () => {
    assert.ok(runnerSource.includes('function normalizeApiKey'));
    assert.match(runnerSource, /\^Bearer\\s\+/);
    assert.ok(runnerSource.includes('"Authorization": `Bearer ${config.apiKey}`'));
  });

  it('prefers provider-specific API keys over the generic fallback', () => {
    assert.ok(runnerSource.includes('args.apiKey || providerKey.value || args.genericApiKey'));
    assert.ok(runnerSource.includes('args.apiKey || openAIKey.value || args.genericApiKey'));
  });

  it('records task narration as a flagged row instead of aborting the batch', () => {
    assert.ok(runnerSource.includes('function looksLikeTaskNarration'));
    assert.ok(runnerSource.includes('function buildTaskNarrationIssue'));
    assert.ok(runnerSource.includes('model-output:${generated.modelOutputIssue.kind}'));
    assert.ok(runnerSource.includes('Model Output Preview'));
  });

  it('records provider call failures as flagged rows instead of aborting the batch', () => {
    assert.ok(runnerSource.includes('function buildProviderCallIssue'));
    assert.ok(runnerSource.includes('${role.toLowerCase()}-provider-error'));
    assert.ok(runnerSource.includes('buildProviderCallIssue(config, "front", err)'));
    assert.ok(runnerSource.includes('buildProviderCallIssue(config, "back", err)'));
    assert.ok(runnerSource.includes('failed during ${role} generation'));
  });

  it('does not treat an unchanged prefix as a generated Front', () => {
    assert.ok(runnerSource.includes('row.front = row.frontSuffix ? joinCompletion(frontPrefix, row.frontSuffix) : ""'));
  });

  it('can judge prefix-specific preferred cards', () => {
    assert.ok(runnerSource.includes('--all-prefixes'));
    assert.ok(runnerSource.includes('function expandCasePrefixes'));
    assert.ok(runnerSource.includes('function getPrefixCarding'));
    assert.ok(runnerSource.includes('carding.prefixCards'));
    assert.ok(runnerSource.includes('getExpectedBack(testCase, generated.frontPrefix)'));
    assert.ok(runnerSource.includes('prefixCardingMatched'));
  });

  it('passes source-stem mode into prompt construction', () => {
    assert.ok(runnerSource.includes('getSourceStemMatch'));
    assert.ok(runnerSource.includes('sourceStem'));
    assert.ok(runnerSource.includes('Source Stem Mode'));
  });

  it('only matches known-bad cards by Back when a bad Back is specified', () => {
    const fns = new Function(`
      const getPrefixCarding = () => ({
        badButPlausibleCards: [{
          front: 'Who introduced the term "deep learning" to the machine learning community?',
          back: 'Rina Dechter in 1986',
        }],
      });
      ${extractFunction(runnerSource, 'normalizeForCompare')}
      ${extractFunction(runnerSource, 'findMatchingBadCard')}
      return { findMatchingBadCard };
    `)();
    const testCase = { carding: { badButPlausibleCards: [] } };
    assert.equal(
      fns.findMatchingBadCard(testCase, {
        frontPrefix: 'Who introduced',
        front: 'Who introduced the term "deep learning" to the machine learning community?',
        back: 'Rina Dechter',
      }),
      null
    );
    assert.ok(
      fns.findMatchingBadCard(testCase, {
        frontPrefix: 'Who introduced',
        front: 'Who introduced the term "deep learning" to the machine learning community?',
        back: 'Rina Dechter in 1986',
      })
    );
  });

  it('does not silently downgrade --run to dry mode when credentials are missing', () => {
    assert.ok(runnerSource.includes('function buildMissingApiKeyError'));
    assert.ok(runnerSource.includes('live eval cannot run'));
    assert.ok(runnerSource.includes('Use --dry-run if you only want to build prompts'));
    assert.ok(!runnerSource.includes('falling back to dry prompt-build mode'));
  });
});
