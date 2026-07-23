const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const backgroundSource = fs.readFileSync(
  path.resolve(__dirname, '../../background.js'), 'utf8'
);
const panelSource = fs.readFileSync(
  path.resolve(__dirname, '../../panel.js'), 'utf8'
);
const optionsSource = fs.readFileSync(
  path.resolve(__dirname, '../../options.js'), 'utf8'
);
const optionsHtml = fs.readFileSync(
  path.resolve(__dirname, '../../options.html'), 'utf8'
);
const privacySource = fs.readFileSync(
  path.resolve(__dirname, '../../PRIVACY_POLICY.md'), 'utf8'
);

function extractFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}`);
  if (functionStart === -1) throw new Error(`Could not find function: ${name}`);
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const paramsStart = source.indexOf('(', functionStart);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    if (source[i] === '(') paramsDepth += 1;
    if (source[i] === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        paramsEnd = i;
        break;
      }
    }
  }
  const bodyStart = source.indexOf('{', paramsEnd);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract function body: ${name}`);
}

function makeHeaders(values = {}) {
  const entries = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return { get: (name) => entries.get(String(name).toLowerCase()) ?? null };
}

function makeQuotaRuntime(source, initialState) {
  let stored = initialState === undefined
    ? {}
    : { ghostwriter_free_tier: structuredClone(initialState) };
  const writes = [];
  const chrome = {
    storage: {
      local: {
        async get() { return structuredClone(stored); },
        async set(value) {
          stored = { ...stored, ...structuredClone(value) };
          writes.push(structuredClone(value));
        },
      },
    },
  };
  const crypto = { randomUUID: () => 'generated-install-id' };
  const quotaErrorHelper = source.includes('function getFreeTierQuotaError')
    ? extractFunction(source, 'getFreeTierQuotaError')
    : 'const getFreeTierQuotaError = undefined;';
  const runtime = new Function('chrome', 'crypto', `
    const FREE_TIER_LIMIT = 100;
    const FREE_TIER_KEY = "ghostwriter_free_tier";
    let freeTierStateQueue = Promise.resolve();
    ${extractFunction(source, 'withFreeTierStateLock')}
    ${extractFunction(source, 'normalizeFreeTierUsed')}
    ${extractFunction(source, 'normalizeFreeTierState')}
    ${extractFunction(source, 'readFreeTierQuotaHeader')}
    ${extractFunction(source, 'parseFreeTierQuotaHeaders')}
    ${extractFunction(source, 'getFreeTierState')}
    ${extractFunction(source, 'reconcileFreeTierUsage')}
    ${quotaErrorHelper}
    return {
      getFreeTierState,
      parseFreeTierQuotaHeaders,
      reconcileFreeTierUsage,
      getFreeTierQuotaError,
    };
  `)(chrome, crypto);

  return {
    ...runtime,
    getStored: () => structuredClone(stored.ghostwriter_free_tier),
    writes,
  };
}

for (const [label, source] of [
  ['background', backgroundSource],
  ['panel', panelSource],
]) {
  describe(`${label} free model request accounting`, () => {
    it('migrates the old 20/10 record to 100 lifetime requests without changing identity', async () => {
      const quota = makeQuotaRuntime(source, {
        installId: 'existing-install-id',
        used: 20,
        dailyDate: '2026-07-22',
        dailyUsed: 10,
      });

      const state = await quota.getFreeTierState();

      assert.equal(state.installId, 'existing-install-id');
      assert.equal(state.used, 20);
      assert.equal(state.limit, 100);
      assert.equal(state.remaining, 80);
      assert.deepEqual(quota.getStored(), {
        installId: 'existing-install-id',
        used: 20,
      });
    });

    it('ignores old daily usage and treats 100 lifetime requests as exhausted', async () => {
      const underLimit = makeQuotaRuntime(source, {
        installId: 'existing-install-id',
        used: 11,
        dailyUsed: 999,
      });
      assert.equal((await underLimit.getFreeTierState()).remaining, 89);

      const exhausted = makeQuotaRuntime(source, {
        installId: 'existing-install-id',
        used: 100,
        dailyUsed: 0,
      });
      assert.equal((await exhausted.getFreeTierState()).remaining, 0);
    });

    it('generates an installation id only when one is missing', async () => {
      const quota = makeQuotaRuntime(source, { used: 7 });
      const state = await quota.getFreeTierState();

      assert.equal(state.installId, 'generated-install-id');
      assert.equal(state.used, 7);
      assert.deepEqual(quota.getStored(), {
        installId: 'generated-install-id',
        used: 7,
      });
    });

    it('reconciles authoritative Worker headers monotonically across out-of-order responses', async () => {
      const quota = makeQuotaRuntime(source, {
        installId: 'existing-install-id',
        used: 20,
      });

      await quota.reconcileFreeTierUsage(makeHeaders({
        'x-ghostwriter-quota-lifetime-used': 22,
        'x-ghostwriter-quota-lifetime-limit': 100,
        'x-ghostwriter-quota-lifetime-remaining': 78,
      }), { requestSucceeded: true });
      await quota.reconcileFreeTierUsage(makeHeaders({
        'x-ghostwriter-quota-lifetime-used': 21,
        'x-ghostwriter-quota-lifetime-limit': 100,
        'x-ghostwriter-quota-lifetime-remaining': 79,
      }), { requestSucceeded: true });

      assert.deepEqual(quota.getStored(), {
        installId: 'existing-install-id',
        used: 22,
      });
    });

    it('serializes concurrent responses so a stale write cannot win', async () => {
      const quota = makeQuotaRuntime(source, {
        installId: 'existing-install-id',
        used: 20,
      });

      await Promise.all([
        quota.reconcileFreeTierUsage(makeHeaders({
          'x-ghostwriter-quota-lifetime-used': 22,
          'x-ghostwriter-quota-lifetime-limit': 100,
          'x-ghostwriter-quota-lifetime-remaining': 78,
        }), { requestSucceeded: true }),
        quota.reconcileFreeTierUsage(makeHeaders({
          'x-ghostwriter-quota-lifetime-used': 21,
          'x-ghostwriter-quota-lifetime-limit': 100,
          'x-ghostwriter-quota-lifetime-remaining': 79,
        }), { requestSucceeded: true }),
      ]);

      assert.equal(quota.getStored().used, 22);
    });

    it('derives authoritative usage from limit and remaining when used is omitted', async () => {
      const quota = makeQuotaRuntime(source, {
        installId: 'existing-install-id',
        used: 20,
      });

      const parsed = quota.parseFreeTierQuotaHeaders(makeHeaders({
        'x-ghostwriter-quota-lifetime-limit': 100,
        'x-ghostwriter-quota-lifetime-remaining': 77,
      }));
      assert.equal(parsed.used, 23);

      await quota.reconcileFreeTierUsage(makeHeaders({
        'x-ghostwriter-quota-lifetime-limit': 100,
        'x-ghostwriter-quota-lifetime-remaining': 77,
      }), { requestSucceeded: true });
      assert.equal(quota.getStored().used, 23);
    });

    it('falls back to one local increment when an older successful Worker omits quota headers', async () => {
      const quota = makeQuotaRuntime(source, {
        installId: 'existing-install-id',
        used: 20,
      });

      await quota.reconcileFreeTierUsage(makeHeaders(), { requestSucceeded: true });

      assert.equal(quota.getStored().used, 21);
    });

    if (label === 'panel') it('distinguishes permanent lifetime exhaustion from temporary network and service limits', () => {
      const quota = makeQuotaRuntime(source, {
        installId: 'existing-install-id',
        used: 20,
      });

      const exhausted = quota.getFreeTierQuotaError(
        429,
        'quota exhausted',
        makeHeaders({ 'x-ghostwriter-quota-reason': 'install_lifetime_exhausted' })
      );
      assert.equal(exhausted.code, 'free_tier_lifetime_exhausted');
      assert.match(exhausted.message, /100 of 100/);
      assert.doesNotMatch(exhausted.message, /try again/i);

      const throttled = quota.getFreeTierQuotaError(
        429,
        'quota exhausted',
        makeHeaders({
          'x-ghostwriter-quota-reason': 'ip_rate_limited',
          'retry-after': '3600',
        })
      );
      assert.equal(throttled.code, 'free_tier_ip_throttled');
      assert.match(throttled.message, /temporarily/i);
      assert.match(throttled.message, /try again/i);
      assert.equal(throttled.retryAfterSeconds, 3600);

      const inFlight = quota.getFreeTierQuotaError(
        429,
        'quota exhausted',
        makeHeaders({
          'x-ghostwriter-quota-reason': 'install_quota_in_flight',
          'retry-after': '30',
        })
      );
      assert.equal(inFlight.code, 'free_tier_in_flight');
      assert.match(inFlight.message, /already in progress/i);
      assert.doesNotMatch(inFlight.message, /100 of 100/i);
      assert.equal(inFlight.retryAfterSeconds, 30);

      const serviceCapacity = quota.getFreeTierQuotaError(
        429,
        'quota exhausted',
        makeHeaders({
          'x-ghostwriter-quota-reason': 'global_daily_exhausted',
          'retry-after': '7200',
        })
      );
      assert.equal(serviceCapacity.code, 'free_tier_service_capacity');
      assert.match(serviceCapacity.message, /included model service/i);
      assert.match(serviceCapacity.message, /temporarily at capacity/i);
      assert.match(serviceCapacity.message, /own provider|on-device|local model/i);
      assert.equal(serviceCapacity.retryAfterSeconds, 7200);
    });
  });
}

describe('free model request copy and disclosure', () => {
  it('uses the same 100-request lifetime limit in every extension context', () => {
    for (const source of [backgroundSource, panelSource, optionsSource]) {
      assert.match(source, /const FREE_TIER_LIMIT = 100;/);
    }
  });

  it('uses one consistent 100-request per-profile status message', () => {
    const exactCopy = 'Included model requests remaining: ${remaining} of 100 — per browser profile';
    assert.ok(optionsSource.includes(exactCopy));
    assert.ok(optionsHtml.includes('Included model requests remaining: 100 of 100 — per browser profile'));
  });

  it('removes the obsolete per-install daily accounting from extension runtime code', () => {
    for (const source of [backgroundSource, panelSource, optionsSource]) {
      assert.doesNotMatch(source, /FREE_TIER_DAILY_LIMIT/);
      assert.doesNotMatch(source, /dailyUsed|dailyRemaining|dailyDate/);
    }
  });

  it('documents a 100-request lifetime allowance per browser installation or profile', () => {
    assert.match(privacySource, /100 lifetime model requests per browser (?:installation|profile)/i);
    assert.doesNotMatch(privacySource, /20 lifetime|10 per day|daily usage count/i);
  });
});

describe('free model request response wiring', () => {
  it('reconciles every successful or rejected proxy response from the panel', () => {
    assert.doesNotMatch(panelSource, /incrementFreeTierUsage/);
    const calls = panelSource.match(
      /await reconcileFreeTierUsage\((?:r|res)\.headers, \{ requestSucceeded: (?:r|res)\.ok \}\);/g
    ) || [];
    assert.equal(calls.length, 2, 'JSON and text completion paths must both reconcile quota');
  });

  it('does not retain a service-worker structured-response path around panel routing', () => {
    assert.doesNotMatch(backgroundSource, /quickflash:ultimateChatJSON|usingFreeTier/);
  });

  it('turns free-tier 429 responses into quota-specific errors', () => {
    assert.match(
      panelSource,
      /if \(provider === "free-tier" && status === 429\) \{[\s\S]*?getFreeTierQuotaError\(status, message, headers\)/
    );
  });

  it('uses the lifetime-specific error before sending a request after local exhaustion', () => {
    assert.doesNotMatch(panelSource, /free suggestions used up/i);
    assert.match(panelSource, /throw createFreeTierLifetimeError\(\)/);
    assert.doesNotMatch(backgroundSource, /quickflash:ultimateChatJSON/);
  });

  it('centralizes panel quota writes and all UI quota reads in the service worker', () => {
    assert.match(panelSource, /type: "ghostwriter:getFreeTierState"/);
    assert.match(panelSource, /type: "ghostwriter:reconcileFreeTierUsage"/);
    assert.match(optionsSource, /type: "ghostwriter:getFreeTierState"/);
    assert.doesNotMatch(optionsSource, /ghostwriter_free_tier/);
    assert.match(backgroundSource, /message\.type === "ghostwriter:getFreeTierState"/);
    assert.match(backgroundSource, /message\.type === "ghostwriter:reconcileFreeTierUsage"/);
  });
});
