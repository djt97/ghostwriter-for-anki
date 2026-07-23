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

  it('passes trailing-space prefix metadata to both Front and Cloze prompt builders', () => {
    const builders = new Function(`
      const FRONT_WORD_CAP = 18;
      const BACK_WORD_CAP = 14;
      const getEvalPrefix = (testCase) => testCase.frontPrefix || '';
      const makePage = (fixture, testCase) => ({
        selection: testCase.sourceText,
        title: fixture.source?.title || '',
        url: fixture.source?.url || '',
      });
      ${extractFunction(runnerSource, 'buildFrontPrompt')}
      ${extractFunction(runnerSource, 'buildClozePrompt')}
      return { buildFrontPrompt, buildClozePrompt };
    `)();
    const seen = [];
    const prompts = {
      frontSystem: 'front',
      clozeSystem: 'cloze',
      buildUserPrompt(meta) {
        seen.push(meta);
        return 'prompt';
      },
    };
    const helpers = {
      selectRelevantSource: (source) => source,
      getSourceStemMatch: () => null,
      inferProtectedAnswerFromSource: () => '',
    };
    const fixtureInput = { source: { title: 'Example', url: '' } };
    const testCase = { sourceText: 'A source fact.', frontPrefix: 'Who introduced ' };

    builders.buildFrontPrompt({ fixture: fixtureInput, testCase, prompts, helpers });
    builders.buildClozePrompt({ fixture: fixtureInput, testCase, prompts, helpers });

    assert.equal(seen.length, 2);
    assert.equal(seen[0].prefixEndsWithSpace, true, 'Front prompt preserves trailing-space intent');
    assert.equal(seen[1].prefixEndsWithSpace, true, 'Cloze prompt preserves trailing-space intent');
  });

  it('uses the shared runtime core and mirrors the one-retry Front guard', () => {
    assert.ok(runnerSource.includes('require(path.join(ROOT, "copilot-core.js"))'));
    assert.ok(runnerSource.includes('COPILOT_CORE.validateClozeCompletion'));
    assert.ok(runnerSource.includes('helpers.buildFrontGuardRetryPrompt'));
    assert.ok(runnerSource.includes('row.rawFrontRetry'));
    assert.ok(runnerSource.includes('retryBlockReason'));
    assert.doesNotMatch(
      runnerSource,
      /normalizeCopilotSuggestion\(sourceStemCompletion\.back[\s\S]{0,120}BACK_WORD_CAP/
    );
  });

  it('mirrors runtime suppression when a Back answers the wrong source relation', () => {
    assert.match(runnerSource, /getBackSourceAlignmentIssue\(row\.front, row\.back, testCase\.sourceText\)/);
    assert.match(runnerSource, /row\.localBackGuard = \{ blockReason: runtimeBackIssue, rejectedBack: row\.back \}/);
    assert.match(runnerSource, /row\.back = ""/);
  });

  it('uses shared Cloze validation and performs exactly one guarded Cloze retry', () => {
    const runCaseSource = extractFunction(runnerSource, 'runCase');
    const clozeStart = runCaseSource.indexOf('if (carding.verdict === "cloze")');
    const clozeEnd = runCaseSource.indexOf('\n  if (sourceStemCompletion', clozeStart);
    assert.ok(clozeStart >= 0 && clozeEnd > clozeStart, 'isolates the Cloze generation branch');
    const clozeBranch = runCaseSource.slice(clozeStart, clozeEnd);

    assert.ok(
      clozeBranch.includes('COPILOT_CORE.validateClozeCompletion'),
      'eval uses the same structured Cloze validator as the extension runtime'
    );
    assert.ok(
      clozeBranch.includes('COPILOT_CORE.buildClozeGuardRetryPrompt'),
      'eval uses the shared rejection-specific Cloze retry prompt'
    );
    assert.ok(
      clozeBranch.includes('COPILOT_CORE.cleanClozeCompletionText')
        && clozeBranch.includes('requiredNewDeletions: 1'),
      'eval canonicalizes provider text and enforces the runtime one-new-deletion contract'
    );
    assert.ok(clozeBranch.includes('row.rawClozeRetry'), 'eval reports the single retry output');
    assert.equal(
      (clozeBranch.match(/await chatCompletion\(/g) || []).length,
      2,
      'Cloze path makes one initial call and at most one retry call'
    );
  });

  it('gates token-boundary Front/Back phrases, Cloze cardinality, and prefix drift', () => {
    assert.ok(runnerSource.includes('requiredFrontPhraseGroups'));
    assert.ok(runnerSource.includes('requiredBackPhraseGroups'));
    assert.ok(runnerSource.includes('forbiddenBackPhrases'));
    assert.ok(runnerSource.includes('maxClozeDeletions'));
    assert.ok(runnerSource.includes('"front-prefix-drift"'));
    assert.ok(runnerSource.includes('COPILOT_CORE.containsTokenPhrase'));

    const getHardFlags = new Function(`
      ${extractFunction(runnerSource, 'getHardFlags')}
      return getHardFlags;
    `)();
    const groupFlags = [
      'front-missing-required-group:machine learning community|1986',
      'back-missing-required-group:Rina Dechter|Aizenberg',
    ];
    assert.deepEqual(
      getHardFlags({ judgment: { flags: [...groupFlags, 'fixture:review-only'] } }),
      groupFlags,
      'missing every alternative in a required phrase group must fail the gate'
    );
  });

  it('allows only an explicitly declared suppression caused by a local guard', () => {
    const isAllowedGuardedSuppression = new Function(`
      ${extractFunction(runnerSource, 'isAllowedGuardedSuppression')}
      return isAllowedGuardedSuppression;
    `)();
    const rules = { allowGuardedSuppression: true };
    const guarded = {
      front: '',
      back: '',
      localGuard: { blockReason: 'Front adds concepts not present in the Source' },
      modelOutputIssue: null,
    };

    assert.equal(isAllowedGuardedSuppression(rules, guarded), true);
    assert.equal(isAllowedGuardedSuppression({}, guarded), false);
    assert.equal(isAllowedGuardedSuppression(rules, { ...guarded, localGuard: {} }), false);
    assert.equal(
      isAllowedGuardedSuppression(rules, {
        ...guarded,
        modelOutputIssue: { kind: 'front-provider-error' },
      }),
      false
    );
  });

  it('merges and hard-gates required phrases inside Cloze deletions', () => {
    const getCardingSource = extractFunction(runnerSource, 'getCarding');
    const getPrefixCardingSource = extractFunction(runnerSource, 'getPrefixCarding');
    const judgeCaseSource = extractFunction(runnerSource, 'judgeCase');
    const gateSource = extractFunction(runnerSource, 'getHardFlags');

    assert.ok(
      getCardingSource.includes('requiredClozeDeletionPhrases'),
      'case-level required Cloze deletion phrases are normalized'
    );
    assert.ok(
      getPrefixCardingSource.includes('requiredClozeDeletionPhrases'),
      'prefix-level required Cloze deletion phrases are merged'
    );
    assert.ok(
      judgeCaseSource.includes('requiredClozeDeletionPhrases')
        && judgeCaseSource.includes('deletion.content')
        && judgeCaseSource.includes('COPILOT_CORE.containsTokenPhrase'),
      'Cloze judge searches inside parsed deletion content, not the surrounding sentence'
    );
    assert.ok(
      judgeCaseSource.includes('cloze-missing-required-deletion'),
      'Cloze judge emits a dedicated missing-required-deletion flag'
    );
    assert.ok(
      gateSource.includes('cloze-missing-required-deletion'),
      'missing a required Cloze deletion phrase is a hard gate failure'
    );
  });

  it('scopes known misses to exact models and exact hard flags', () => {
    assert.ok(runnerSource.includes('function normalizeKnownMiss'));
    assert.ok(runnerSource.includes('miss.models.includes(config.model)'));
    assert.ok(runnerSource.includes('miss.allowedFlags.includes(flag)'));
    assert.ok(!runnerSource.includes('!row.knownMiss && isHard(row)'));
  });

  it('only matches known-bad cards by Back when a bad Back is specified', () => {
    const fns = new Function(`
      const getPrefixCarding = () => ({
        badButPlausibleCards: [
          {
            type: 'basic',
            front: 'Who introduced the term "deep learning" to the machine learning community?',
            back: 'Rina Dechter in 1986',
          },
          { type: 'cloze', text: 'The term was introduced by {{c1::Rina Dechter}}.' },
        ],
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
    assert.ok(
      fns.findMatchingBadCard(testCase, {
        frontPrefix: '',
        cloze: 'The term was introduced by {{c1::Rina Dechter}}.',
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
