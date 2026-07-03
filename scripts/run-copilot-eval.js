#!/usr/bin/env node
/* eslint-env node */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_FIXTURE = path.join(ROOT, "tests/evals/deep-learning-wikipedia.json");
const DEFAULT_OUT_DIR = path.join(ROOT, "tests/evals/reports");
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const ULTIMATE_BASE_URL = "https://api.ultimateai.org/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const ULTIMATE_HOST_RE = /^https:\/\/(?:api|smart|chat)\.ultimateai\.org$/i;
const ULTIMATE_DEFAULT_MODEL = "auto";
const FRONT_WORD_CAP = 18;
const BACK_WORD_CAP = 14;

function parseArgs(argv) {
  const genericKey = readEnvApiKey("GHOSTWRITER_EVAL_API_KEY");
  const args = {
    fixture: DEFAULT_FIXTURE,
    outDir: DEFAULT_OUT_DIR,
    provider: process.env.GHOSTWRITER_EVAL_PROVIDER || "",
    model: process.env.GHOSTWRITER_EVAL_MODEL || process.env.OPENAI_MODEL || "",
    baseUrl: process.env.GHOSTWRITER_EVAL_BASE_URL || process.env.OPENAI_BASE_URL || "",
    apiKey: "",
    apiKeySource: "",
    genericApiKey: genericKey.value,
    genericApiKeySource: genericKey.source,
    limit: 0,
    caseIds: new Set(),
    allPrefixes: false,
    run: false,
    dryRun: false,
    write: true,
    includePrompts: false,
    listModels: false,
    gate: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === "--fixture") args.fixture = path.resolve(next());
    else if (arg === "--out") args.outDir = path.resolve(next());
    else if (arg === "--provider") args.provider = next();
    else if (arg === "--model") args.model = next();
    else if (arg === "--base-url") args.baseUrl = next();
    else if (arg === "--api-key-env") {
      const envName = next();
      const key = readEnvApiKey(envName);
      args.apiKey = key.value;
      args.apiKeySource = key.source || envName;
    }
    else if (arg === "--limit") args.limit = Number(next()) || 0;
    else if (arg === "--case") args.caseIds.add(next());
    else if (arg === "--all-prefixes") args.allPrefixes = true;
    else if (arg === "--run") args.run = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--no-write") args.write = false;
    else if (arg === "--include-prompts") args.includePrompts = true;
    else if (arg === "--list-models") args.listModels = true;
    else if (arg === "--gate") args.gate = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-copilot-eval.js [options]

Options:
  --run                    Call the model. Without this, the script does a dry prompt build.
  --gate                    With --run, exit non-zero if any case produces a bad card
                            (answer leak, drift, non-fit, restated Back, or a known-bad card).
  --fixture <path>          Eval fixture JSON. Default: tests/evals/deep-learning-wikipedia.json
  --out <dir>               Report output directory. Default: tests/evals/reports
  --provider <name>         openai, openrouter, ultimate, gemini, or compatible. Default: inferred from env.
  --model <model>           Model name. Defaults to provider-compatible Ghostwriter settings.
  --base-url <url>          OpenAI-compatible base URL.
  --api-key-env <name>      Read the API key from a named environment variable.
  --limit <n>               Run only the first n cases after filtering.
  --case <id>               Run a single case id. Can be repeated.
  --all-prefixes            Expand each selected case across its plausible prefixes.
  --dry-run                 Force dry mode, even if --run and an API key are present.
  --no-write                Print summary only; do not write report files.
  --include-prompts         Include full prompts in the JSON report.
  --list-models             Print models exposed by the selected provider/base URL.

Tip:
  UltimateAI docs currently recommend https://api.ultimateai.org/v1 as the
  OpenAI-compatible base URL. Legacy smart/chat hosts are still accepted.
  Use --list-models to see which model IDs your API key can access.

Environment:
  GHOSTWRITER_EVAL_API_KEY  Generic fallback OpenAI-compatible API key.
  OPENAI_API_KEY            Used for --provider openai.
  OPENROUTER_API_KEY        Used for --provider openrouter.
  ULTIMATE_API_KEY          Used for --provider ultimate.
  ULTIMATEAI_API_KEY        Also accepted for --provider ultimate.
  GEMINI_API_KEY            Used for --provider gemini.
  GHOSTWRITER_EVAL_MODEL    Model override.
  GHOSTWRITER_EVAL_BASE_URL Base URL override.`);
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizeApiKey(value) {
  let key = String(value || "").trim();
  key = key.replace(/^['"]+|['"]+$/g, "").trim();
  key = key.replace(/^Bearer\s+/i, "").trim();
  return key;
}

function readEnvApiKey(...names) {
  for (const name of names) {
    const key = normalizeApiKey(process.env[name]);
    if (key) return { value: key, source: name };
  }
  return { value: "", source: "" };
}

function normalizeUltimateBaseUrl(value) {
  const raw = String(value || ULTIMATE_BASE_URL).trim().replace(/\/+$/g, "");
  if (!raw) return ULTIMATE_BASE_URL;
  if (ULTIMATE_HOST_RE.test(raw)) return `${raw}/v1`;
  return raw;
}

function normalizeGeminiBaseUrl(value) {
  return String(value || GEMINI_BASE_URL).trim().replace(/\/+$/g, "") || GEMINI_BASE_URL;
}

function getGeminiThinkingConfig(modelName) {
  const model = String(modelName || "").toLowerCase();
  if (/gemini-2\.5-flash(?:-lite)?(?:-|$)/.test(model) || model === "gemini-2.5-flash" || model === "gemini-2.5-flash-lite") {
    return { thinkingBudget: 0 };
  }
  return null;
}

function describeApiKey(config) {
  if (!config.apiKey) return "no API key";
  const source = config.apiKeySource || "unknown source";
  return `${source}, ${config.apiKey.length} chars`;
}

function looksLikeTaskNarration(value) {
  return /^(?:the user\b|i\b|we\b|looking at\b|based on\b|this (?:card|front|back|source)\b|the (?:front|back|source)\b)/i
    .test(String(value || "").trim());
}

function buildTaskNarrationIssue(config, role, rawText) {
  const preview = clip(rawText, 220);
  return {
    kind: `${role.toLowerCase()}-task-narration`,
    role,
    message: `${config.provider} model ${config.model} returned ${role} task narration instead of autocomplete text.`,
    preview,
  };
}

function buildProviderCallIssue(config, role, err) {
  const preview = clip(err?.message || String(err), 260);
  return {
    kind: `${role.toLowerCase()}-provider-error`,
    role,
    message: `${config.provider} model ${config.model} failed during ${role} generation.`,
    preview,
  };
}

function buildMissingApiKeyError(config) {
  const providerHint = config.provider === "ultimate"
    ? "Set ULTIMATE_API_KEY or ULTIMATEAI_API_KEY."
    : config.provider === "openai"
    ? "Set OPENAI_API_KEY."
    : "Set GHOSTWRITER_EVAL_API_KEY or pass --api-key-env NAME.";
  return new Error(
    `No API key found for --provider ${config.provider}; live eval cannot run.\n` +
    `${providerHint}\n` +
    "The eval runner reads shell environment variables, not Chrome extension settings. " +
    "Use --dry-run if you only want to build prompts without calling a model."
  );
}

function extractDeclaration(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start === -1) throw new Error(`Could not find declaration: ${name}`);
  const end = source.indexOf(");", start);
  if (end === -1) throw new Error(`Could not parse declaration: ${name}`);
  return source.slice(start, end + 2);
}

function extractStringConst(source, name) {
  const regex = new RegExp(`const ${name}\\s*=\\s*(["'][^"']+["']);`);
  const match = source.match(regex);
  if (!match) throw new Error(`Could not extract string const: ${name}`);
  return `const ${name} = ${match[1]};`;
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`Could not find function: ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") parenDepth += 1;
    if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsEnd = i;
        break;
      }
    }
  }
  if (paramsEnd === -1) throw new Error(`Could not parse parameters for: ${name}`);
  const bodyStart = source.indexOf("{", paramsEnd);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract function: ${name}`);
}

function loadEngine() {
  const panelSource = fs.readFileSync(path.join(ROOT, "panel.js"), "utf8");
  const promptsSource = fs.readFileSync(path.join(ROOT, "prompts.js"), "utf8");
  const promptWindow = {};
  const prompts = new Function("window", `${promptsSource}\nreturn window.QUICKFLASH_PROMPTS;`)(promptWindow);

  const helpers = new Function(`
    const copilot = { frontWordCap: ${FRONT_WORD_CAP}, backWordCap: ${BACK_WORD_CAP} };
    ${extractDeclaration(panelSource, "FRONT_ANSWER_CUE_TERMS")}
    ${extractDeclaration(panelSource, "FRONT_ANSWER_CONTEXT_TERMS")}
    ${extractDeclaration(panelSource, "FRONT_ANSWER_GENERIC_TERMS")}
    ${extractStringConst(panelSource, "STATEMENT_VERB_PATTERN")}
    ${extractStringConst(panelSource, "STATEMENT_REFERENT_PATTERN")}
    ${extractStringConst(panelSource, "EQUATION_REFERENT_PATTERN")}
    ${extractFunction(panelSource, "buildCompletionPrefixIndex")}
    ${extractFunction(panelSource, "getTypedWordCount")}
    ${extractFunction(panelSource, "isStateCommandPrefix")}
    ${extractFunction(panelSource, "isDistinctiveSingleSourceStemPrefix")}
    ${extractFunction(panelSource, "getSourceStemMatch")}
    ${extractFunction(panelSource, "selectRelevantSource")}
    ${extractFunction(panelSource, "normalizeStatementSourceText")}
    ${extractFunction(panelSource, "cleanStatementSubject")}
    ${extractFunction(panelSource, "cleanStatementAlias")}
    ${extractFunction(panelSource, "extractStatementAliases")}
    ${extractFunction(panelSource, "extractStatementKinds")}
    ${extractFunction(panelSource, "normalizeStatementVerb")}
    ${extractFunction(panelSource, "cleanStatementAnswer")}
    ${extractFunction(panelSource, "parseDirectStatementSplit")}
    ${extractFunction(panelSource, "parseCopularStatementSplit")}
    ${extractFunction(panelSource, "parseEquationStatementSplit")}
    ${extractFunction(panelSource, "getNamedStatementSubject")}
    ${extractFunction(panelSource, "parseAnaphoricStatementSplit")}
    ${extractFunction(panelSource, "getSourceStatementSplit")}
    ${extractFunction(panelSource, "getStatementSubjectForPrefix")}
    ${extractFunction(panelSource, "sourceStemTargetsStatement")}
    ${extractFunction(panelSource, "cleanSourceStemAnswer")}
    ${extractFunction(panelSource, "firstSourceStemSentence")}
    ${extractFunction(panelSource, "buildSourceStemCompletion")}
    ${extractFunction(panelSource, "isExactComplementSourceStemPrefix")}
    ${extractFunction(panelSource, "buildExactComplementSourceStemCompletion")}
    ${extractFunction(panelSource, "buildStatementSourceStemCompletion")}
    ${extractFunction(panelSource, "cleanSourcePatternQuestionPhrase")}
    ${extractFunction(panelSource, "shortenPeriodBoundaryPhrase")}
    ${extractFunction(panelSource, "buildPatternSourceCompletion")}
    ${extractFunction(panelSource, "inferApproachSourceCompletion")}
    ${extractFunction(panelSource, "inferPeriodSourceCompletion")}
    ${extractFunction(panelSource, "inferContextSourceCompletion")}
    ${extractFunction(panelSource, "inferAliasSourceCompletion")}
    ${extractFunction(panelSource, "inferAbbreviationSourceCompletion")}
    ${extractFunction(panelSource, "inferCoreProblemSourceCompletion")}
    ${extractFunction(panelSource, "inferCorpusContentsSourceCompletion")}
    ${extractFunction(panelSource, "inferNamedSetSourceCompletion")}
    ${extractFunction(panelSource, "inferMeaningSourceCompletion")}
    ${extractFunction(panelSource, "inferGovernmentRepealSourceCompletion")}
    ${extractFunction(panelSource, "inferTreeStructureSourceCompletion")}
    ${extractFunction(panelSource, "inferWordFunctionSourceCompletion")}
    ${extractFunction(panelSource, "inferDirectDefinitionSourceCompletion")}
    ${extractFunction(panelSource, "inferOriginSourceCompletion")}
    ${extractFunction(panelSource, "inferContrastTypesSourceCompletion")}
    ${extractFunction(panelSource, "inferPipelineSourceCompletion")}
    ${extractFunction(panelSource, "inferLabelCaptureSourceCompletion")}
    ${extractFunction(panelSource, "inferYearEventSourceCompletion")}
    ${extractFunction(panelSource, "inferKindOfInverseSourceCompletion")}
    ${extractFunction(panelSource, "inferReceiveLabelsSourceCompletion")}
    ${extractFunction(panelSource, "inferConditionsSourceCompletion")}
    ${extractFunction(panelSource, "inferColonExplanationSourceCompletion")}
    ${extractFunction(panelSource, "inferContrastDifferenceSourceCompletion")}
    ${extractFunction(panelSource, "inferAnalogySolutionSourceCompletion")}
    ${extractFunction(panelSource, "inferPrecedesSourceCompletion")}
    ${extractFunction(panelSource, "inferReverseDefinitionSourceCompletion")}
    ${extractFunction(panelSource, "inferTeachesPurposeSourceCompletion")}
    ${extractFunction(panelSource, "inferSourcePatternCompletion")}
    ${extractFunction(panelSource, "inferSourceStemCompletion")}
    ${extractFunction(panelSource, "stripExistingPrefixFromCompletion")}
    ${extractFunction(panelSource, "stripCopilotMetaOutput")}
    ${extractFunction(panelSource, "isDanglingCompletionWord")}
    ${extractFunction(panelSource, "truncateCopilotSuggestionWords")}
    ${extractFunction(panelSource, "normalizeCopilotSuggestion")}
    ${extractFunction(panelSource, "stripFrontFromBack")}
    ${extractFunction(panelSource, "finalizeFrontQuestion")}
    ${extractFunction(panelSource, "normalizeFrontSuggestionForPrefix")}
    ${extractFunction(panelSource, "normalizeFrontLeakText")}
    ${extractFunction(panelSource, "normalizeAnswerTerm")}
    ${extractFunction(panelSource, "singularizeAnswerTerm")}
    ${extractFunction(panelSource, "getAnswerTerms")}
    ${extractFunction(panelSource, "getSourceGroundingTerms")}
    ${extractFunction(panelSource, "getFrontSourceGroundingIssue")}
    ${extractFunction(panelSource, "isAdvantageFront")}
    ${extractFunction(panelSource, "inferAnswerRoleFromFront")}
    ${extractFunction(panelSource, "stripAdvantageComparisonTail")}
    ${extractFunction(panelSource, "normalizeDefinedTermAlias")}
    ${extractFunction(panelSource, "inferExplicitDefinitionFromSource")}
    ${extractFunction(panelSource, "frontIncludesDefinedTermAlias")}
    ${extractFunction(panelSource, "isWhoFrontWithoutDateTarget")}
    ${extractFunction(panelSource, "stripUnaskedDateFromWhoAnswer")}
    ${extractFunction(panelSource, "normalizeStandaloneBackAnswer")}
    ${extractFunction(panelSource, "backRestatesFront")}
    ${extractFunction(panelSource, "getBackAnswerFitIssue")}
    ${extractFunction(panelSource, "normalizeBackSuggestionForFront")}
    ${extractFunction(panelSource, "stripAnswerCueLead")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromAdvantageSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromApproachSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromContextSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromAliasSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromAbbreviationSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromCoreProblemSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromCorpusContentsSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromNamedSetSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromMeaningSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromGovernmentRepealSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromTreeStructureSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromWordFunctionSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromDirectDefinitionSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromOriginSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromContrastTypesSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromPipelineSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromLabelCaptureSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromYearEventSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromKindOfInverseSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromReceiveLabelsSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromConditionsSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromColonExplanationSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromContrastDifferenceSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromAnalogySolutionSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromPrecedesSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromReverseDefinitionSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromTeachesPurposeSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromSimpleFactSource")}
    ${extractFunction(panelSource, "inferProtectedAnswerFromSource")}
    ${extractFunction(panelSource, "getAnswerTermLeakReason")}
    ${extractFunction(panelSource, "getFrontAnswerLeakReason")}
    ${extractFunction(panelSource, "getFrontCompletionFitIssue")}
    ${extractFunction(panelSource, "getFrontRelationshipDriftIssue")}
    ${extractFunction(panelSource, "getFrontDefinitionDriftIssue")}
    function getContextSourceText(page) { return String(page?.sourceText || page?.selection || "").trim(); }
    ${extractFunction(panelSource, "getFrontSuggestionBlockReason")}
    return {
      normalizeCopilotSuggestion,
      getSourceStemMatch,
      selectRelevantSource,
      inferSourceStemCompletion,
      stripFrontFromBack,
      finalizeFrontQuestion,
      normalizeFrontSuggestionForPrefix,
      inferAnswerRoleFromFront,
      inferProtectedAnswerFromSource,
      getFrontAnswerLeakReason,
      getFrontCompletionFitIssue,
      getFrontRelationshipDriftIssue,
      getFrontDefinitionDriftIssue,
      getFrontSuggestionBlockReason,
      normalizeBackSuggestionForFront,
      getBackAnswerFitIssue,
    };
  `)();

  return { prompts, helpers };
}

function resolveProviderConfig(args) {
  let provider = (args.provider || "").toLowerCase();
  if (!provider) {
    if (readEnvApiKey("ULTIMATE_API_KEY", "ULTIMATEAI_API_KEY").value) provider = "ultimate";
    else if (readEnvApiKey("GEMINI_API_KEY").value) provider = "gemini";
    else provider = "openai";
  }

  if (provider === "ultimate") {
    const providerKey = readEnvApiKey("ULTIMATE_API_KEY", "ULTIMATEAI_API_KEY");
    const apiKey = args.apiKey || providerKey.value || args.genericApiKey;
    return {
      provider,
      baseUrl: normalizeUltimateBaseUrl(args.baseUrl),
      apiKey,
      apiKeySource: args.apiKeySource || providerKey.source || args.genericApiKeySource,
      model: args.model || ULTIMATE_DEFAULT_MODEL,
    };
  }

  if (provider === "gemini") {
    const providerKey = readEnvApiKey("GEMINI_API_KEY");
    const apiKey = args.apiKey || providerKey.value || args.genericApiKey;
    return {
      provider,
      baseUrl: normalizeGeminiBaseUrl(args.baseUrl),
      apiKey,
      apiKeySource: args.apiKeySource || providerKey.source || args.genericApiKeySource,
      model: args.model || "gemini-2.5-flash-lite",
    };
  }

  if (provider === "compatible") {
    const apiKey = args.apiKey || args.genericApiKey;
    return {
      provider,
      baseUrl: (args.baseUrl || "https://api.openai.com/v1").replace(/\/+$/g, ""),
      apiKey,
      apiKeySource: args.apiKeySource || args.genericApiKeySource,
      model: args.model || OPENAI_DEFAULT_MODEL,
    };
  }

  if (provider === "openrouter") {
    const providerKey = readEnvApiKey("OPENROUTER_API_KEY");
    const apiKey = args.apiKey || providerKey.value || args.genericApiKey;
    return {
      provider,
      baseUrl: (args.baseUrl || OPENROUTER_BASE_URL).replace(/\/+$/g, ""),
      apiKey,
      apiKeySource: args.apiKeySource || providerKey.source || args.genericApiKeySource,
      model: args.model || "openrouter/auto",
    };
  }

  const openAIKey = readEnvApiKey("OPENAI_API_KEY");
  const apiKey = args.apiKey || openAIKey.value || args.genericApiKey;
  return {
    provider: "openai",
    baseUrl: (args.baseUrl || "https://api.openai.com/v1").replace(/\/+$/g, ""),
    apiKey,
    apiKeySource: args.apiKeySource || openAIKey.source || args.genericApiKeySource,
    model: args.model || OPENAI_DEFAULT_MODEL,
  };
}

function buildProviderHeaders(config) {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.apiKey}`,
  };
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/djt97/ghostwriter-for-anki";
    headers["X-OpenRouter-Title"] = "Ghostwriter for Anki";
  }
  return headers;
}

function clip(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function joinCompletion(prefix, suggestion) {
  const p = String(prefix || "").trim();
  const s = String(suggestion || "").trim();
  if (!p) return s;
  if (!s) return p;
  return `${p} ${s}`.replace(/\s+/g, " ").trim();
}

function makePage(fixture, testCase) {
  return {
    selection: testCase.sourceText,
    title: fixture.source?.title || "",
    url: fixture.source?.url || "",
  };
}

function getCarding(testCase) {
  const carding = testCase.carding && typeof testCase.carding === "object"
    ? testCase.carding
    : {};
  const fallbackPreferred = [];
  if (testCase.expectedFront || testCase.expectedBack) {
    fallbackPreferred.push({
      type: "basic",
      front: testCase.expectedFront || "",
      back: testCase.expectedBack || "",
    });
  }
  return {
    verdict: carding.verdict || (fallbackPreferred.length ? "basic" : "maybe"),
    rationale: carding.rationale || "",
    plausibleUserPrefixes: Array.isArray(carding.plausibleUserPrefixes) ? carding.plausibleUserPrefixes : [],
    preferredCards: Array.isArray(carding.preferredCards) ? carding.preferredCards : fallbackPreferred,
    alternateCards: Array.isArray(carding.alternateCards) ? carding.alternateCards : [],
    badButPlausibleCards: Array.isArray(carding.badButPlausibleCards) ? carding.badButPlausibleCards : [],
    prefixCards: Array.isArray(carding.prefixCards) ? carding.prefixCards : [],
    knownMiss: typeof carding.knownMiss === "string" ? carding.knownMiss : "",
  };
}

function normalizePrefixText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function cardListKey(card) {
  if (!card) return "";
  return [
    card.type || "",
    normalizePrefixText(card.front || ""),
    normalizePrefixText(card.back || ""),
    normalizePrefixText(card.text || ""),
  ].join("|");
}

function mergeCardLists(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const card of list) {
      const key = cardListKey(card);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(card);
    }
  }
  return merged;
}

function getEvalPrefix(testCase) {
  const carding = getCarding(testCase);
  return testCase.frontPrefix || carding.plausibleUserPrefixes[0] || "";
}

function getPrefixCarding(testCase, prefix = getEvalPrefix(testCase)) {
  const carding = getCarding(testCase);
  const matchPrefix = normalizePrefixText(prefix);
  const prefixCarding = carding.prefixCards.find((entry) => (
    entry && normalizePrefixText(entry.prefix) === matchPrefix
  ));
  if (!prefixCarding) {
    return {
      preferredCards: carding.preferredCards,
      alternateCards: carding.alternateCards,
      badButPlausibleCards: carding.badButPlausibleCards,
      matchedPrefix: "",
      knownMiss: carding.knownMiss || "",
    };
  }

  const preferredCards = Array.isArray(prefixCarding.preferredCards)
    ? prefixCarding.preferredCards
    : carding.preferredCards;
  const alternateCards = mergeCardLists(prefixCarding.alternateCards, carding.alternateCards);
  const badButPlausibleCards = mergeCardLists(prefixCarding.badButPlausibleCards, carding.badButPlausibleCards);

  return {
    preferredCards,
    alternateCards,
    badButPlausibleCards,
    matchedPrefix: prefixCarding.prefix || "",
    knownMiss: (typeof prefixCarding.knownMiss === "string" && prefixCarding.knownMiss) || carding.knownMiss || "",
  };
}

function getPreferredBasicCard(testCase, prefix = getEvalPrefix(testCase)) {
  return getPrefixCarding(testCase, prefix).preferredCards.find((card) => card?.type === "basic") || null;
}

function getPrimaryPreferredCard(testCase, prefix = getEvalPrefix(testCase)) {
  const prefixCarding = getPrefixCarding(testCase, prefix);
  return getPreferredBasicCard(testCase, prefix) || prefixCarding.preferredCards[0] || null;
}

function getExpectedFront(testCase, prefix = getEvalPrefix(testCase)) {
  const card = getPreferredBasicCard(testCase, prefix);
  return card?.front || testCase.expectedFront || "";
}

function getExpectedBack(testCase, prefix = getEvalPrefix(testCase)) {
  const card = getPreferredBasicCard(testCase, prefix);
  return card?.back || testCase.expectedBack || "";
}

function normalizeForCompare(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findMatchingBadCard(testCase, generated) {
  const generatedFront = normalizeForCompare(generated.front);
  if (!generatedFront) return null;
  const generatedBack = normalizeForCompare(generated.back);
  return getPrefixCarding(testCase, generated.frontPrefix).badButPlausibleCards.find((card) => {
    const badFront = normalizeForCompare(card?.front);
    if (!badFront || generatedFront !== badFront) return false;
    const badBack = normalizeForCompare(card?.back);
    return !badBack || generatedBack === badBack;
  }) || null;
}

function formatCard(card) {
  if (!card) return "";
  if (card.type === "cloze") return `Cloze: ${card.text || ""}`;
  const front = card.front ? `Front: ${card.front}` : "";
  const back = card.back ? `Back: ${card.back}` : "";
  return [card.type || "card", front, back].filter(Boolean).join(" | ");
}

function buildFrontPrompt({ fixture, testCase, prompts, helpers }) {
  const page = makePage(fixture, testCase);
  const frontPrefix = getEvalPrefix(testCase);
  // Mirror the extension: ground the model on the sentence the prefix targets.
  page.selection = helpers.selectRelevantSource(testCase.sourceText, frontPrefix, "");
  const sourceStem = helpers.getSourceStemMatch(testCase.sourceText, frontPrefix);
  const protectedAnswer = helpers.inferProtectedAnswerFromSource(
    testCase.sourceText,
    frontPrefix
  );
  return {
    system: prompts.frontSystem,
    prompt: prompts.buildUserPrompt({
      fieldId: "front",
      existing: frontPrefix,
      other: "",
      protectedAnswer,
      sourceStem,
      notes: "",
      page,
      caps: { frontWordCap: FRONT_WORD_CAP, backWordCap: BACK_WORD_CAP },
    }),
    protectedAnswer,
    sourceStem,
  };
}

function buildBackPrompt({ fixture, testCase, front, prompts, helpers }) {
  const page = makePage(fixture, testCase);
  // Mirror the pipeline: the Back uses a small centered window so an answer one clause away is available.
  page.selection = helpers.selectRelevantSource(testCase.sourceText, "", front, { before: 1, after: 1 });
  const answerRole = helpers.inferAnswerRoleFromFront(front);
  return {
    system: prompts.backSystem,
    prompt: prompts.buildUserPrompt({
      fieldId: "back",
      existing: "",
      other: front,
      protectedAnswer: "",
      answerRole,
      notes: "",
      page,
      caps: { frontWordCap: FRONT_WORD_CAP, backWordCap: BACK_WORD_CAP },
    }),
    answerRole,
  };
}

function buildClozePrompt({ fixture, testCase, prompts, helpers }) {
  const page = makePage(fixture, testCase);
  const frontPrefix = getEvalPrefix(testCase);
  page.selection = helpers.selectRelevantSource(testCase.sourceText, frontPrefix, "");
  return {
    system: prompts.clozeSystem || prompts.frontSystem,
    prompt: prompts.buildUserPrompt({
      fieldId: "front",
      existing: frontPrefix,
      other: "",
      cloze: true,
      notes: "",
      page,
      caps: { frontWordCap: FRONT_WORD_CAP, backWordCap: BACK_WORD_CAP },
    }),
  };
}

async function chatCompletion(config, { system, prompt, maxTokens }) {
  if (config.provider === "gemini") {
    return geminiCompletion(config, { system, prompt, maxTokens });
  }

  const payload = {
    model: config.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: maxTokens,
    n: 1,
    stream: false,
    stop: ["\n\n", "\nQuestion:", "\nAnswer:"],
  };

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: buildProviderHeaders(config),
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  let data = null;
  try { data = JSON.parse(bodyText); } catch {}
  if (!response.ok) {
    const message = data?.error?.message || data?.detail || bodyText || response.statusText;
    if (response.status === 401) {
      throw new Error(
        `${config.provider} authentication failed at ${config.baseUrl}: ${message}\n` +
        `Key source: ${describeApiKey(config)}.\n` +
        "The eval runner reads API keys from shell environment variables, not from Chrome extension settings. " +
        "Set ULTIMATE_API_KEY (or ULTIMATEAI_API_KEY), or pass --api-key-env NAME. " +
        "Do not include a leading 'Bearer '; the runner adds it."
      );
    }
    throw new Error(`${config.provider} error ${response.status}: ${message}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return { text: content.trim(), model: String(data?.model || "") };
  }
  if (Array.isArray(content)) {
    return {
      text: content.map((part) => part?.text || part?.content || "").join("").trim(),
      model: String(data?.model || ""),
    };
  }
  return { text: "", model: String(data?.model || "") };
}

async function geminiCompletion(config, { system, prompt, maxTokens }) {
  const thinkingConfig = getGeminiThinkingConfig(config.model);
  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.1,
      stopSequences: ["\n\n", "\nQuestion:", "\nAnswer:"],
      responseMimeType: "text/plain",
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
    ...(system ? { systemInstruction: { role: "system", parts: [{ text: system }] } } : {}),
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
    ],
  };

  const endpoint = `${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  let response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let bodyText = await response.text();

  if (!response.ok && bodyText.includes("safetySettings")) {
    const retryPayload = { ...payload };
    delete retryPayload.safetySettings;
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(retryPayload),
    });
    bodyText = await response.text();
  }

  let data = null;
  try { data = JSON.parse(bodyText); } catch {}
  if (!response.ok) {
    const message = data?.error?.message || data?.detail || bodyText || response.statusText;
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `${config.provider} authentication failed at ${config.baseUrl}: ${message}\n` +
        `Key source: ${describeApiKey(config)}.\n` +
        "The eval runner reads API keys from shell environment variables, not from Chrome extension settings. " +
        "Set GEMINI_API_KEY, or pass --api-key-env NAME."
      );
    }
    throw new Error(`${config.provider} error ${response.status}: ${message}`);
  }

  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const parts = candidates[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return {
      text: parts.map((part) => part?.text || "").join("").trim(),
      model: String(data?.modelVersion || data?.model || config.model || ""),
    };
  }
  return { text: "", model: String(data?.modelVersion || data?.model || config.model || "") };
}

async function listProviderModels(config) {
  if (config.provider === "gemini") {
    const response = await fetch(`${config.baseUrl}/models?key=${encodeURIComponent(config.apiKey)}`);
    const bodyText = await response.text();
    let data = null;
    try { data = JSON.parse(bodyText); } catch {}
    if (!response.ok) {
      const message = data?.error?.message || data?.detail || bodyText || response.statusText;
      throw new Error(`${config.provider} models error ${response.status}: ${message}`);
    }
    const rows = Array.isArray(data?.models) ? data.models : [];
    for (const row of rows) {
      const rawName = row?.name || "";
      const id = rawName.replace(/^models\//, "");
      const methods = Array.isArray(row?.supportedGenerationMethods)
        ? `\t${row.supportedGenerationMethods.join(",")}`
        : "";
      if (id) console.log(`${id}${methods}`);
    }
    return;
  }

  const response = await fetch(`${config.baseUrl}/models`, {
    method: "GET",
    headers: buildProviderHeaders(config),
  });
  const bodyText = await response.text();
  let data = null;
  try { data = JSON.parse(bodyText); } catch {}
  if (!response.ok) {
    const message = data?.error?.message || data?.detail || bodyText || response.statusText;
    if (response.status === 401) {
      throw new Error(
        `${config.provider} authentication failed at ${config.baseUrl}/models: ${message}\n` +
        `Key source: ${describeApiKey(config)}.`
      );
    }
    throw new Error(`${config.provider} models error ${response.status}: ${message}`);
  }

  const rows = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
    ? data.models
    : Array.isArray(data)
    ? data
    : [];
  if (!rows.length) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  for (const row of rows) {
    const id = typeof row === "string" ? row : row?.id || row?.name || row?.model || "";
    const label = typeof row === "object" && row && row.name && row.name !== id ? `\t${row.name}` : "";
    if (id) console.log(`${id}${label}`);
  }
}

function judgeCase(testCase, generated, helpers) {
  const flags = [];
  const carding = getCarding(testCase);
  const expectedBack = getExpectedBack(testCase, generated.frontPrefix);

  if (generated.dryRun) {
    return {
      flags,
      status: "dry-run",
      expectedLeak: "",
      engineLeak: "",
      backFitIssue: "",
      badCard: null,
    };
  }

  // Cloze cards are judged on the cloze output: it must carry at least one {{c1::...}} deletion.
  if (carding.verdict === "cloze") {
    const clozeText = generated.cloze || generated.rawCloze || "";
    if (generated.modelOutputIssue?.kind) flags.push(`model-output:${generated.modelOutputIssue.kind}`);
    else if (!clozeText) flags.push("missing-cloze");
    else if (!/\{\{c\d+::[^}]+\}\}/.test(clozeText)) flags.push("cloze-no-deletion");
    return { flags, status: flags.length ? "needs-review" : "review", clozeText };
  }

  if (generated.modelOutputIssue?.kind) {
    flags.push(`model-output:${generated.modelOutputIssue.kind}`);
  }

  if (carding.verdict === "skip" && (generated.front || generated.back)) {
    flags.push("fixture:skip-highlight");
  } else if (carding.verdict === "cloze" && (generated.front || generated.back)) {
    flags.push("fixture:prefers-cloze");
  } else if (carding.verdict === "maybe") {
    flags.push("fixture:maybe-salvage");
  }

  if (carding.verdict === "basic" && !generated.front) flags.push("missing-front");
  if (carding.verdict === "basic" && !generated.back) flags.push("missing-back");

  const expectedLeak = expectedBack
    ? helpers.getFrontAnswerLeakReason(generated.front, {
        existingText: generated.frontPrefix,
        backText: expectedBack,
      })
    : "";
  if (expectedLeak) flags.push(`front-leak:${expectedLeak}`);

  const engineLeak = helpers.getFrontAnswerLeakReason(generated.front, {
    existingText: generated.frontPrefix,
    backText: generated.protectedAnswer,
  });
  if (engineLeak) flags.push(`protected-leak:${engineLeak}`);

  const frontFitIssue = helpers.getFrontCompletionFitIssue(generated.front);
  if (frontFitIssue) flags.push(`front-fit:${frontFitIssue}`);

  const relationshipDrift = helpers.getFrontRelationshipDriftIssue(generated.front, {
    sourceText: testCase.sourceText,
    existingText: generated.frontPrefix,
  });
  if (relationshipDrift) flags.push(`front-drift:${relationshipDrift}`);

  const definitionDrift = helpers.getFrontDefinitionDriftIssue(generated.front, {
    sourceText: testCase.sourceText,
    existingText: generated.frontPrefix,
  });
  if (definitionDrift) flags.push(`front-drift:${definitionDrift}`);

  const backFitIssue = helpers.getBackAnswerFitIssue(generated.front, generated.back);
  if (backFitIssue) flags.push(`back-fit:${backFitIssue}`);

  if (generated.front && !generated.front.toLowerCase().startsWith(generated.frontPrefix.trim().toLowerCase())) {
    flags.push("front-prefix-drift");
  }

  const badCard = findMatchingBadCard(testCase, generated);
  if (badCard) flags.push("matches-known-bad-card");

  return {
    flags,
    status: flags.length ? "needs-review" : "review",
    expectedLeak,
    engineLeak,
    frontFitIssue,
    relationshipDrift,
    definitionDrift,
    backFitIssue,
    badCard: badCard ? { front: badCard.front || "", whyBad: badCard.whyBad || "" } : null,
  };
}

async function runCase({ fixture, testCase, prompts, helpers, config, live, includePrompts }) {
  const frontPrompt = buildFrontPrompt({ fixture, testCase, prompts, helpers });
  const carding = getCarding(testCase);
  const frontPrefix = getEvalPrefix(testCase);
  const prefixCarding = getPrefixCarding(testCase, frontPrefix);
  const sourceStemCompletion = helpers.inferSourceStemCompletion(testCase.sourceText, frontPrefix);
  const row = {
    id: testCase.id,
    baseId: testCase.baseId || testCase.id,
    section: testCase.section,
    tags: testCase.tags || [],
    sourceText: testCase.sourceText,
    frontPrefix,
    cardingVerdict: carding.verdict,
    cardingRationale: carding.rationale,
    plausibleUserPrefixes: carding.plausibleUserPrefixes,
    prefixCardingMatched: prefixCarding.matchedPrefix,
    knownMiss: prefixCarding.knownMiss || "",
    preferredCards: prefixCarding.preferredCards,
    alternateCards: prefixCarding.alternateCards,
    badButPlausibleCards: prefixCarding.badButPlausibleCards,
    expectedFront: getExpectedFront(testCase, frontPrefix),
    expectedBack: getExpectedBack(testCase, frontPrefix),
    primaryPreferredCard: getPrimaryPreferredCard(testCase, frontPrefix),
    protectedAnswer: frontPrompt.protectedAnswer,
    sourceStem: frontPrompt.sourceStem,
    rawFront: "",
    frontSuffix: "",
    front: "",
    rawBack: "",
    back: "",
    frontActualModel: "",
    backActualModel: "",
    localGuard: null,
    answerRole: null,
    modelOutputIssue: null,
    dryRun: !live,
  };

  if (includePrompts) {
    row.frontPrompt = frontPrompt.prompt;
    row.frontSystem = frontPrompt.system;
  }

  // Cloze cards take the cloze path (clozeSystem + cloze:true), not the Q&A/stem path.
  if (carding.verdict === "cloze") {
    if (live) {
      const clozePrompt = buildClozePrompt({ fixture, testCase, prompts, helpers });
      if (includePrompts) {
        row.clozePrompt = clozePrompt.prompt;
        row.clozeSystem = clozePrompt.system;
      }
      try {
        const clozeCompletion = await chatCompletion(config, {
          system: clozePrompt.system,
          prompt: clozePrompt.prompt,
          maxTokens: 90,
        });
        row.rawCloze = clozeCompletion.text;
        row.clozeActualModel = clozeCompletion.model;
        // The model may return the full sentence (incl. the prefix) or just the suffix.
        const rawClozeTrim = String(row.rawCloze || "").trim();
        row.cloze = rawClozeTrim.toLowerCase().startsWith(frontPrefix.trim().toLowerCase())
          ? rawClozeTrim
          : joinCompletion(frontPrefix, rawClozeTrim).trim();
      } catch (err) {
        row.modelOutputIssue = buildProviderCallIssue(config, "cloze", err);
      }
    }
    row.judgment = judgeCase(testCase, row, helpers);
    return row;
  }

  if (sourceStemCompletion?.frontSuffix && sourceStemCompletion?.back) {
    row.rawFront = sourceStemCompletion.frontSuffix;
    row.frontSuffix = helpers.normalizeFrontSuggestionForPrefix(
      frontPrefix,
      helpers.normalizeCopilotSuggestion(sourceStemCompletion.frontSuffix, frontPrefix, {
        role: "front",
        maxWords: FRONT_WORD_CAP,
      })
    );
    row.front = row.frontSuffix ? joinCompletion(frontPrefix, row.frontSuffix) : "";
    row.rawBack = sourceStemCompletion.back;
    row.back = helpers.normalizeBackSuggestionForFront(
      helpers.normalizeCopilotSuggestion(sourceStemCompletion.back, "", {
        role: "back",
        maxWords: BACK_WORD_CAP,
      }),
      row.front
    );
    row.sourceStemCompletion = sourceStemCompletion;
    row.judgment = judgeCase(testCase, row, helpers);
    return row;
  }

  if (!live) {
    row.judgment = judgeCase(testCase, row, helpers);
    return row;
  }

  try {
    const frontCompletion = await chatCompletion(config, {
      system: frontPrompt.system,
      prompt: frontPrompt.prompt,
      maxTokens: 40,
    });
    row.rawFront = frontCompletion.text;
    row.frontActualModel = frontCompletion.model;
  } catch (err) {
    row.modelOutputIssue = buildProviderCallIssue(config, "front", err);
    row.judgment = judgeCase(testCase, row, helpers);
    return row;
  }
  row.frontSuffix = helpers.normalizeFrontSuggestionForPrefix(
    frontPrefix,
    helpers.normalizeCopilotSuggestion(row.rawFront, frontPrefix, {
      role: "front",
      maxWords: FRONT_WORD_CAP,
    })
  );
  if (!row.frontSuffix && looksLikeTaskNarration(row.rawFront)) {
    row.modelOutputIssue = buildTaskNarrationIssue(config, "front", row.rawFront);
    row.judgment = judgeCase(testCase, row, helpers);
    return row;
  }
  row.front = row.frontSuffix ? joinCompletion(frontPrefix, row.frontSuffix) : "";

  const leakReason = row.front
    ? helpers.getFrontAnswerLeakReason(row.front, {
        existingText: frontPrefix,
        backText: frontPrompt.protectedAnswer,
      })
    : "";
  const frontFitIssue = row.front ? helpers.getFrontCompletionFitIssue(row.front) : "";
  const relationshipDrift = row.front ? helpers.getFrontRelationshipDriftIssue(row.front, {
    sourceText: testCase.sourceText,
    existingText: frontPrefix,
  }) : "";
  const definitionDrift = row.front ? helpers.getFrontDefinitionDriftIssue(row.front, {
    sourceText: testCase.sourceText,
    existingText: frontPrefix,
  }) : "";
  const frontBlockReason = leakReason || frontFitIssue || relationshipDrift || definitionDrift;
  if (row.frontSuffix && frontBlockReason) {
    row.localGuard = {
      leakReason,
      fitIssue: frontFitIssue,
      relationshipDrift,
      definitionDrift,
      blockReason: frontBlockReason,
    };
    row.frontSuffix = "";
    row.front = "";
  }

  if (row.front) {
    const backPrompt = buildBackPrompt({ fixture, testCase, front: row.front, prompts, helpers });
    row.answerRole = backPrompt.answerRole?.kind || null;
    if (includePrompts) {
      row.backPrompt = backPrompt.prompt;
      row.backSystem = backPrompt.system;
    }
    try {
      const backCompletion = await chatCompletion(config, {
        system: backPrompt.system,
        prompt: backPrompt.prompt,
        maxTokens: 30,
      });
      row.rawBack = backCompletion.text;
      row.backActualModel = backCompletion.model;
    } catch (err) {
      row.modelOutputIssue = buildProviderCallIssue(config, "back", err);
      row.judgment = judgeCase(testCase, row, helpers);
      return row;
    }
    let back = helpers.normalizeCopilotSuggestion(row.rawBack, "", {
      role: "back",
      maxWords: BACK_WORD_CAP,
    });
    back = helpers.stripFrontFromBack(back, row.front);
    back = helpers.normalizeBackSuggestionForFront(back, row.front);
    row.back = back;
    if (!row.back && looksLikeTaskNarration(row.rawBack)) {
      row.modelOutputIssue = buildTaskNarrationIssue(config, "back", row.rawBack);
    }
  }

  row.judgment = judgeCase(testCase, row, helpers);
  return row;
}

function tableEscape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function renderCardList(cards) {
  if (!Array.isArray(cards) || !cards.length) return ["(none)"];
  return cards.map((card) => `- ${formatCard(card)}${card.whyBad ? ` (${card.whyBad})` : ""}${card.rationale ? ` (${card.rationale})` : ""}`);
}

function renderMarkdown({ fixture, config, live, rows }) {
  const generatedAt = new Date().toISOString();
  const reportedModels = Array.from(new Set(
    rows.flatMap((row) => [row.frontActualModel, row.backActualModel])
      .map((model) => String(model || "").trim())
      .filter(Boolean)
  ));
  const lines = [
    `# ${fixture.name}`,
    "",
    `Generated: ${generatedAt}`,
    `Mode: ${live ? "live model calls" : "dry prompt build"}`,
    `Source: [${fixture.source?.title || "source"}](${fixture.source?.url || ""})`,
    live ? `Provider/model: ${config.provider} / ${config.model}` : "Provider/model: not called",
    ...(live && reportedModels.length ? [`Provider reported model(s): ${reportedModels.join(", ")}`] : []),
    "",
    "| Case | Verdict | Prefix | Generated Front | Generated Back | Preferred Target | Flags |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of rows) {
    lines.push([
      row.id,
      row.cardingVerdict,
      row.frontPrefix,
      clip(row.front, 120),
      clip(row.back, 120),
      clip(formatCard(row.primaryPreferredCard), 140),
      row.judgment?.flags?.join("; ") || "",
    ].map((cell) => tableEscape(cell)).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  lines.push(
    "",
    "## Details",
    ""
  );

  for (const row of rows) {
    const matchedBadCardLine = row.judgment?.badCard?.whyBad
      ? [`Matched known bad card because: ${row.judgment.badCard.whyBad}`]
      : [];
    const modelOutputIssueLines = row.modelOutputIssue
      ? [
          `Model Output Issue: ${row.modelOutputIssue.message}`,
          `Model Output Preview: ${row.modelOutputIssue.preview}`,
          "",
        ]
      : [];
    const actualModelLines = row.frontActualModel || row.backActualModel
      ? [
          `Provider Reported Front Model: ${row.frontActualModel || "(none)"}`,
          `Provider Reported Back Model: ${row.backActualModel || "(none)"}`,
          "",
        ]
      : [];
    lines.push(
      `### ${row.id}`,
      "",
      `Section: ${row.section}`,
      `Tags: ${(row.tags || []).join(", ")}`,
      `Verdict: ${row.cardingVerdict}`,
      `Rationale: ${row.cardingRationale || "(none)"}`,
      `Prefix: ${row.frontPrefix}`,
      `Highlight: ${row.sourceText}`,
      row.cardingVerdict === "cloze"
        ? `Generated Cloze: ${row.cloze || "(none)"}`
        : `Generated Front: ${row.front || "(none)"}`,
      row.cardingVerdict === "cloze" ? "" : `Generated Back: ${row.back || "(none)"}`,
      "",
      "Preferred cards:",
      ...renderCardList(row.preferredCards),
      "",
      "Alternate cards:",
      ...renderCardList(row.alternateCards),
      "",
      "Known bad but plausible cards:",
      ...renderCardList(row.badButPlausibleCards),
      "",
      `Source Stem Mode: ${row.sourceStem ? "yes" : "no"}`,
      `Protected Answer Inferred: ${row.protectedAnswer || "(none)"}`,
      `Answer Role: ${row.answerRole || "(none)"}`,
      ...actualModelLines,
      ...modelOutputIssueLines,
      `Flags: ${row.judgment?.flags?.join("; ") || "(none)"}`,
      ...matchedBadCardLine,
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}

function slugifyPrefix(prefix) {
  const slug = String(prefix || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "prefix";
}

function getCasePrefixes(testCase) {
  const carding = getCarding(testCase);
  const candidates = [
    testCase.frontPrefix,
    ...carding.plausibleUserPrefixes,
    ...carding.prefixCards.map((entry) => entry?.prefix || ""),
  ];
  const seen = new Set();
  return candidates.filter((prefix) => {
    const key = normalizePrefixText(prefix);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function expandCasePrefixes(testCase) {
  const prefixes = getCasePrefixes(testCase);
  if (prefixes.length <= 1) return [testCase];
  return prefixes.map((prefix, index) => ({
    ...testCase,
    id: index === 0 ? testCase.id : `${testCase.id}__${slugifyPrefix(prefix)}`,
    baseId: testCase.id,
    frontPrefix: prefix,
  }));
}

function selectCases(fixture, args) {
  let cases = fixture.cases || [];
  if (args.caseIds.size) {
    cases = cases.filter((testCase) => args.caseIds.has(testCase.id));
  }
  if (args.allPrefixes) {
    cases = cases.flatMap(expandCasePrefixes);
  }
  if (args.limit > 0) cases = cases.slice(0, args.limit);
  return cases;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = resolveProviderConfig(args);
  if (args.listModels) {
    if (!config.apiKey) throw buildMissingApiKeyError(config);
    console.error(`Listing ${config.provider} models at ${config.baseUrl} with key from ${describeApiKey(config)}.`);
    await listProviderModels(config);
    return;
  }

  const fixture = readJSON(args.fixture);
  const { prompts, helpers } = loadEngine();
  const cases = selectCases(fixture, args);
  const live = !!(args.run && !args.dryRun && config.apiKey);

  if (!cases.length) throw new Error("No eval cases selected.");
  if (args.run && !config.apiKey && !args.dryRun) {
    throw buildMissingApiKeyError(config);
  }
  if (live) {
    console.error(
      `Using ${config.provider} model ${config.model} at ${config.baseUrl} ` +
      `with key from ${describeApiKey(config)}.`
    );
  }

  const rows = [];
  for (const testCase of cases) {
    process.stderr.write(`${live ? "Running" : "Preparing"} ${testCase.id}...\n`);
    rows.push(await runCase({
      fixture,
      testCase,
      prompts,
      helpers,
      config,
      live,
      includePrompts: args.includePrompts,
    }));
  }

  const report = {
    fixture: {
      name: fixture.name,
      source: fixture.source,
      fixturePath: path.relative(ROOT, args.fixture),
    },
    generatedAt: new Date().toISOString(),
    mode: live ? "live" : "dry-run",
    provider: live ? { provider: config.provider, baseUrl: config.baseUrl, model: config.model } : null,
    cases: rows,
  };

  const markdown = renderMarkdown({ fixture, config, live, rows });
  if (args.write) {
    fs.mkdirSync(args.outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.join(args.outDir, `copilot-eval-${stamp}`);
    fs.writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(`${base}.md`, markdown);
    console.log(`Wrote ${path.relative(ROOT, `${base}.md`)}`);
    console.log(`Wrote ${path.relative(ROOT, `${base}.json`)}`);
  } else {
    console.log(markdown);
  }

  const flagged = rows.filter((row) => row.judgment?.flags?.length);
  console.log(`${rows.length} cases prepared; ${flagged.length} flagged for review.`);
  if (!live) {
    console.log("Dry run only. Add --run and an API key env var to call the autocomplete model.");
  }
  if (args.gate && live) {
    // Hard failures: the model produced an actually-bad card (leak, drift, non-fit,
    // restated Back, matched a known-bad card, missing field). Soft "fixture:*" review
    // flags do not gate. Cases annotated with a knownMiss reason are documented model
    // limitations: they still run and appear in reports, but do not fail the gate.
    const HARD = ["front-leak", "protected-leak", "front-fit", "front-drift", "back-fit", "matches-known-bad-card", "missing-front", "missing-back", "model-output", "missing-cloze", "cloze-no-deletion"];
    const isHard = (row) => (row.judgment?.flags || []).some((f) => HARD.some((h) => String(f).startsWith(h)));
    const hardFails = rows.filter((row) => !row.knownMiss && isHard(row));
    const knownMisses = rows.filter((row) => row.knownMiss && isHard(row));
    if (knownMisses.length) {
      console.log(`Known misses (documented in the fixture, not gating): ${knownMisses.map((r) => r.id).join(", ")}`);
    }
    if (hardFails.length) {
      console.error(`\nGATE FAILED: ${hardFails.length} case(s) produced a bad card:`);
      for (const row of hardFails) {
        console.error(`  - ${row.id} [prefix: ${JSON.stringify(row.frontPrefix)}] front=${JSON.stringify(row.front)} back=${JSON.stringify(row.back)} :: ${(row.judgment.flags || []).join(", ")}`);
      }
      process.exitCode = 1;
    } else {
      console.log("GATE PASSED: no hard failures on cases with expectations.");
    }
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
