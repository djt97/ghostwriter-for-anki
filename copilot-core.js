/* global module */

(function initGhostwriterCopilotCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GhostwriterCopilotCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildGhostwriterCopilotCore() {
  "use strict";

  const WORD_RE = /[\p{L}\p{N}]/u;
  const PREFIX_TITLE_ABBREVIATIONS = new Set([
    "capt", "col", "dr", "gen", "gov", "hon", "lt", "mr", "mrs", "ms", "mx", "pres", "prof", "rep", "rev", "sen", "sgt",
  ]);
  const NUMBER_PREFIX_ABBREVIATIONS = new Set(["ca", "fig", "no"]);
  const SINGLE_PREFIX_STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "cant", "can't", "do", "does", "for",
    "from", "had", "has", "have", "he", "her", "here", "him", "his", "how", "i", "in", "is", "it", "its",
    "may", "not", "of", "on", "or", "our", "she", "that", "the", "their", "them", "there", "these", "they",
    "this", "those", "to", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with", "you", "your",
  ]);
  // Words that can be introduced solely to turn source wording into a question or
  // change its syntax. Deliberately exclude descriptive nouns and relation verbs:
  // a fact-picker card may reorder source vocabulary, but it may not invent a
  // classification ("city") or event ("hosted") that the source never states.
  const CARD_GROUNDING_GLUE_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by", "can", "could",
    "did", "do", "does", "for", "from", "had", "has", "have", "he", "her", "hers", "him", "his",
    "how", "i", "in", "into", "is", "it", "its", "long", "many", "may", "me", "might", "much", "must", "my", "of", "on",
    "or", "our", "ours", "shall", "she", "should", "s", "t", "that", "the", "their", "theirs", "them",
    "these", "they", "this", "those", "to", "us", "was", "we", "were", "what", "when", "where", "which",
    "who", "whom", "whose", "why", "will", "with", "would", "you", "your", "yours",
  ]);
  const CARD_GROUNDING_IRREGULAR_FORMS = new Map([
    ["became", "become"], ["become", "become"],
    ["began", "begin"], ["begin", "begin"], ["begun", "begin"],
    ["bought", "buy"], ["buy", "buy"],
    ["built", "build"], ["build", "build"],
    ["chose", "choose"], ["chosen", "choose"], ["choose", "choose"],
    ["gave", "give"], ["given", "give"], ["give", "give"],
    ["kept", "keep"], ["keep", "keep"],
    ["led", "lead"], ["lead", "lead"],
    ["made", "make"], ["make", "make"],
    ["ran", "run"], ["run", "run"],
    ["said", "say"], ["say", "say"],
    ["saw", "see"], ["seen", "see"], ["see", "see"],
    ["sold", "sell"], ["sell", "sell"],
    ["taught", "teach"], ["teach", "teach"],
    ["take", "take"], ["taken", "take"], ["took", "take"],
    ["went", "go"], ["go", "go"], ["gone", "go"],
    ["write", "write"], ["written", "write"], ["wrote", "write"],
  ]);

  function normalizeQuote(ch) {
    if (/[‘’`]/u.test(ch)) return "'";
    if (/[“”]/u.test(ch)) return '"';
    return ch;
  }

  function buildTextIndex(value, { ignoreApostrophes = false } = {}) {
    const chars = [];
    const starts = [];
    const positions = [];
    let lastWasSpace = false;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
      const raw = text[i];
      if (/[\u200b\u200c\u200d\ufeff]/u.test(raw)) continue;
      const normalizedRaw = normalizeQuote(raw);
      // Apostrophe omission is tolerated only for provider prefix-repeat detection.
      // Literal source matching keeps apostrophes exact (apart from curly/straight style).
      if (ignoreApostrophes && normalizedRaw === "'") continue;
      if (/\s/u.test(raw)) {
        if (chars.length && !lastWasSpace) {
          chars.push(" ");
          starts.push(i);
          positions.push(i + 1);
          lastWasSpace = true;
        } else if (lastWasSpace) {
          // A normalized space represents the whole raw whitespace run. Keep
          // its end offset current so following matches and prefix stripping
          // never retain indentation/newlines as part of the matched prefix.
          positions[positions.length - 1] = i + 1;
        }
        continue;
      }
      chars.push(normalizedRaw.toLocaleLowerCase());
      starts.push(i);
      positions.push(i + 1);
      lastWasSpace = false;
    }
    while (chars[chars.length - 1] === " ") {
      chars.pop();
      starts.pop();
      positions.pop();
    }
    return { text: chars.join(""), starts, positions };
  }

  function isWordChar(ch) {
    return !!ch && WORD_RE.test(ch);
  }

  function findUniqueExactPrefix(sourceText, prefixText) {
    const source = String(sourceText || "");
    const prefix = String(prefixText || "").trim();
    if (!source || !prefix) return null;
    const sourceIndex = buildTextIndex(source);
    const prefixIndex = buildTextIndex(prefix);
    if (!sourceIndex.text || !prefixIndex.text) return null;

    const starts = [];
    let from = 0;
    while (from <= sourceIndex.text.length - prefixIndex.text.length) {
      const start = sourceIndex.text.indexOf(prefixIndex.text, from);
      if (start === -1) break;
      const before = start > 0 ? sourceIndex.text[start - 1] : "";
      const after = sourceIndex.text[start + prefixIndex.text.length] || "";
      if (!isWordChar(before) && !isWordChar(after)) starts.push(start);
      // Advance one normalized character so overlapping duplicate prefixes are
      // counted too ("very very very" contains "very very" twice).
      from = start + 1;
    }
    if (starts.length !== 1) return null;

    const start = starts[0];
    const originalStart = sourceIndex.starts[start] ?? 0;
    const originalEnd = sourceIndex.positions[start + prefixIndex.text.length - 1] || 0;
    return {
      start: originalStart,
      end: originalEnd,
      correctedPrefix: source.slice(originalStart, originalEnd).replace(/\s+/gu, " ").trim(),
      correction: null,
    };
  }

  function tokenizeWordsWithOffsets(value) {
    const text = String(value || "");
    const out = [];
    const re = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
    let match;
    while ((match = re.exec(text))) {
      out.push({ raw: match[0], normalized: buildTextIndex(match[0]).text, start: match.index, end: re.lastIndex });
    }
    return out;
  }

  function editDistanceAtMostOne(a, b) {
    const left = String(a || "");
    const right = String(b || "");
    if (left === right) return 0;
    if (Math.abs(left.length - right.length) > 1) return 2;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        i += 1;
        j += 1;
        continue;
      }
      edits += 1;
      if (edits > 1) return 2;
      if (left.length > right.length) i += 1;
      else if (right.length > left.length) j += 1;
      else {
        i += 1;
        j += 1;
      }
    }
    if (i < left.length || j < right.length) edits += 1;
    return edits;
  }

  function findUniqueTypoPrefix(sourceText, prefixText) {
    const source = String(sourceText || "");
    const typed = tokenizeWordsWithOffsets(prefixText);
    const sourceWords = tokenizeWordsWithOffsets(source);
    if (typed.length < 2 || sourceWords.length < typed.length) return null;
    if (/[^\p{L}\s'’\-]/u.test(String(prefixText || ""))) return null;

    const candidates = [];
    for (let start = 0; start <= sourceWords.length - typed.length; start += 1) {
      let mismatch = null;
      let valid = true;
      for (let i = 0; i < typed.length; i += 1) {
        const actual = typed[i];
        const expected = sourceWords[start + i];
        if (actual.normalized === expected.normalized) continue;
        if (mismatch || actual.normalized.length < 6 || expected.normalized.length < 6) {
          valid = false;
          break;
        }
        if (/\p{N}/u.test(actual.raw) || /\p{N}/u.test(expected.raw)) {
          valid = false;
          break;
        }
        if (/^\p{Lu}/u.test(actual.raw) || /^\p{Lu}/u.test(expected.raw)) {
          valid = false;
          break;
        }
        if (editDistanceAtMostOne(actual.normalized, expected.normalized) !== 1) {
          valid = false;
          break;
        }
        mismatch = { from: actual.raw, to: expected.raw };
      }
      if (!valid || !mismatch) continue;
      const first = sourceWords[start];
      const last = sourceWords[start + typed.length - 1];
      candidates.push({
        start: first.start,
        end: last.end,
        correctedPrefix: source.slice(first.start, last.end).replace(/\s+/gu, " ").trim(),
        correction: mismatch,
      });
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  function firstSourceSentence(value) {
    const text = String(value || "").replace(/^\s+/u, "");
    if (!text) return "";
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "\n") {
        const segment = text.slice(0, i).trim();
        if (segment) return segment.replace(/[.!?]+$/u, "").trim();
        continue;
      }
      if (ch !== "." && ch !== "!" && ch !== "?") continue;
      if (ch === "." && /\d/u.test(text[i - 1] || "") && /\d/u.test(text[i + 1] || "")) continue;
      // Internal initialism/abbreviation dot (U.S., e.g., i.e.). The final dot
      // is handled below, where following lowercase prose may keep it internal.
      if (ch === "." && /\p{L}/u.test(text[i + 1] || "")) continue;
      const before = text.slice(0, i);
      const tokenMatch = before.match(/([\p{L}](?:[\p{L}.]*[\p{L}])?)$/u);
      const token = (tokenMatch?.[1] || "").toLocaleLowerCase();
      const afterPeriod = text.slice(i + 1);
      if (ch === "." && PREFIX_TITLE_ABBREVIATIONS.has(token) && /^\s+\p{Lu}/u.test(afterPeriod)) continue;
      if (ch === "." && NUMBER_PREFIX_ABBREVIATIONS.has(token) && /^\s+\p{N}/u.test(afterPeriod)) continue;
      if (ch === "." && token === "vs" && /^\s+\p{L}/u.test(afterPeriod)) continue;
      if (ch === "." && /^(?:e\.g|i\.e|etc)$/u.test(token) && /^\s*[,;:]/u.test(afterPeriod)) continue;
      if (ch === "." && /^[a-z]$/u.test(token)) {
        const beforeInitial = before.slice(0, Math.max(0, before.length - token.length)).trimEnd();
        const previousToken = beforeInitial.match(/([\p{L}.]+)\s*$/u)?.[1]?.toLocaleLowerCase() || "";
        const followedByInitial = /^\s+\p{Lu}\./u.test(text.slice(i + 1));
        const followsInitialOrTitle = /^\p{L}\.$/u.test(previousToken)
          || PREFIX_TITLE_ABBREVIATIONS.has(previousToken.replace(/\.+$/u, ""));
        if (followedByInitial || followsInitialOrTitle) continue;
      }
      const next = text.slice(i + 1).match(/^\s*([\s\S]?)/u)?.[1] || "";
      if (next && /\p{Ll}/u.test(next)) continue;
      return text.slice(0, i).trim();
    }
    return text.trim().replace(/[.!?]+$/u, "").trim();
  }

  function wordCount(value) {
    return tokenizeWordsWithOffsets(value).length;
  }

  function isDistinctiveSingleSourcePrefix(value) {
    const words = tokenizeWordsWithOffsets(value);
    if (words.length !== 1) return false;
    const word = words[0];
    if (SINGLE_PREFIX_STOP_WORDS.has(word.normalized)) return false;
    return word.normalized.length >= 6
      || /\p{N}/u.test(word.raw)
      || /[-'’]/u.test(word.raw)
      || /^\p{Lu}{2,}\p{Ll}?$/u.test(word.raw);
  }

  function cleanSourcePiece(value) {
    return String(value || "")
      .replace(/\s+/gu, " ")
      .replace(/^[\s,;:.\-–—]+/u, "")
      .replace(/[\s,;:.!?\-–—]+$/u, "")
      .trim();
  }

  function splitAtLiteralConnector(continuation, prefixText) {
    const tail = cleanSourcePiece(continuation);
    if (!tail) return null;
    const normalizedPrefix = String(prefixText || "").replace(/\s+/gu, " ").trim();
    if (/\b(?:by|via|through|using|is|are|was|were|means|equals|denotes|refers\s+to|consists\s+of|is\s+defined\s+as|are\s+defined\s+as|is\s+called|are\s+called|is\s+named\s+(?:after|for)|are\s+named\s+(?:after|for))$/iu.test(normalizedPrefix)) {
      return { lead: "", back: tail };
    }

    const patterns = [
      /^([\s\S]{0,180}?\b(?:by|via|through|using))\s+([\s\S]+)$/iu,
      /^([\s\S]{0,180}?\b(?:iff|if\s+and\s+only\s+if))\s+([\s\S]+)$/iu,
      /^([\s\S]{0,180}?\b(?:not|never|without)\b[\s\S]{0,100}?\s+(?:and|but|rather\s+than|rather|instead))\s+([\s\S]+)$/iu,
      /^([\s\S]{0,180}?\b(?:can|could|may|might|must|should|will|would)\s+(?:also\s+)?(?:be\s+)?[\p{L}-]+(?:ed|en)\s+(?:to|for|as|in|on|with|by|after))\s+([\s\S]+)$/iu,
      /^([\s\S]{0,180}?\b(?:states?|says|holds|claims|argues|asserts|posits|maintains|suggests?|recommends?|means|denotes|equals|refers\s+to|consists\s+of|is|are|was|were))\s+([\s\S]+)$/iu,
    ];
    for (const pattern of patterns) {
      const match = tail.match(pattern);
      if (!match) continue;
      const lead = cleanSourcePiece(match[1]);
      const back = cleanSourcePiece(match[2]);
      if (lead && back) return { lead, back };
    }
    return null;
  }

  function inferLiteralSourceSplit(sourceText, prefixText, options = {}) {
    const {
      allowTypoCorrection = false,
      cardType = "basic",
      existingBack = "",
      pendingBack = "",
      rejectedBack = "",
      maxFrontWords = 18,
      maxBackWords = 24,
    } = options;
    if (String(cardType).toLocaleLowerCase() === "cloze") return null;
    const protectedBackValues = [existingBack, pendingBack, rejectedBack]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    const source = String(sourceText || "");
    const prefix = String(prefixText || "").trim();
    const prefixWords = wordCount(prefix);
    if (!source || !prefix || prefixWords < 1) return null;
    const match = findUniqueExactPrefix(source, prefix)
      || (allowTypoCorrection && prefixWords >= 2 ? findUniqueTypoPrefix(source, prefix) : null);
    if (!match) return null;
    if (prefixWords === 1
        && !isDistinctiveSingleSourcePrefix(prefix)
        && !isDistinctiveSingleSourcePrefix(match.correctedPrefix)) return null;

    const sentence = firstSourceSentence(source.slice(match.start));
    if (!sentence) return null;
    const sourcePrefixLength = match.end - match.start;
    const continuation = sentence.slice(sourcePrefixLength).replace(/^\s+/u, "");
    const split = splitAtLiteralConnector(continuation, match.correctedPrefix);
    if (!split) return null;
    if (protectedBackValues.some((value) => normalizeWords(value) !== normalizeWords(split.back))) return null;
    const fullFrontWords = wordCount(match.correctedPrefix) + wordCount(split.lead);
    if (fullFrontWords > maxFrontWords || wordCount(split.back) > maxBackWords) return null;
    return {
      kind: "source-stem",
      split: "connector",
      frontSuffix: split.lead ? `${split.lead}...` : "...",
      back: split.back,
      correctedPrefix: match.correctedPrefix,
      correction: match.correction,
    };
  }

  function classifyFrontCompletion(existingText, completionText) {
    const existing = buildTextIndex(existingText, { ignoreApostrophes: true }).text;
    const completion = buildTextIndex(completionText, { ignoreApostrophes: true }).text;
    if (!completion) return "empty";
    if (!existing) return "suffix";
    if (completion === existing) return "partial-repeat";
    if (completion.startsWith(existing)) {
      const next = completion[existing.length] || "";
      return isWordChar(next) ? "prefix-drift" : "exact-repeat";
    }
    if (existing.startsWith(completion)) return "partial-repeat";
    const firstExisting = existing.split(" ")[0];
    const firstCompletion = completion.split(" ")[0];
    if (firstExisting && firstExisting === firstCompletion) return "prefix-drift";
    return "suffix";
  }

  function stripExactRepeatedPrefix(existingText, completionText) {
    const index = buildTextIndex(completionText, { ignoreApostrophes: true });
    const prefix = buildTextIndex(existingText, { ignoreApostrophes: true }).text;
    if (!prefix || !index.text.startsWith(prefix)) return String(completionText || "");
    const next = index.text[prefix.length] || "";
    if (isWordChar(next)) return "";
    const cut = index.positions[prefix.length - 1] || 0;
    return String(completionText || "").slice(cut).replace(/^\s+/u, "");
  }

  function normalizeFrontSuffix(existingText, completionText, { maxFrontWords = 18 } = {}) {
    const classification = classifyFrontCompletion(existingText, completionText);
    if (classification === "empty" || classification === "partial-repeat" || classification === "prefix-drift") return "";
    const raw = classification === "exact-repeat"
      ? stripExactRepeatedPrefix(existingText, completionText)
      : String(completionText || "");
    const remaining = Math.max(0, Number(maxFrontWords) - wordCount(existingText));
    if (!raw.trim() || remaining < 1) return "";
    const words = raw.trim().split(/\s+/u);
    return words.slice(0, remaining).join(" ");
  }

  function parseClozeDeletions(value) {
    const text = String(value || "");
    const parseAt = (open) => {
      const header = text.slice(open).match(/^\{\{c\d+::/u)?.[0] || "";
      if (!header) return null;
      const contentStart = open + header.length;
      const children = [];
      let groupingDepth = 0;
      let cursor = contentStart;

      while (cursor < text.length) {
        // A real nested Anki deletion is structural. Other doubled braces are
        // ordinary balanced grouping (common in TeX such as \\frac{{a}}{{b}}).
        if (/^\{\{c\d+::/u.test(text.slice(cursor))) {
          const nested = parseAt(cursor);
          if (!nested) return null;
          children.push(...nested.nodes);
          cursor = nested.end;
          continue;
        }
        if (text.startsWith("{{c", cursor)) return null;

        const ch = text[cursor];
        if (ch === "{") {
          groupingDepth += 1;
          cursor += 1;
          continue;
        }
        if (ch !== "}") {
          cursor += 1;
          continue;
        }
        if (groupingDepth > 0) {
          groupingDepth -= 1;
          cursor += 1;
          continue;
        }
        if (text[cursor + 1] !== "}") return null;

        const end = cursor + 2;
        const content = text.slice(contentStart, cursor);
        if (!content.trim()) return null;
        const node = { start: open, contentStart, end, content };
        return { end, nodes: [node, ...children] };
      }
      return null;
    };

    const deletions = [];
    let groupingDepth = 0;
    let cursor = 0;
    while (cursor < text.length) {
      if (/^\{\{c\d+::/u.test(text.slice(cursor))) {
        const parsed = parseAt(cursor);
        if (!parsed) return null;
        deletions.push(...parsed.nodes);
        cursor = parsed.end;
        continue;
      }
      if (text.startsWith("{{c", cursor)) return null;
      const ch = text[cursor];
      if (ch === "{") groupingDepth += 1;
      else if (ch === "}") {
        if (groupingDepth < 1) return null;
        groupingDepth -= 1;
      }
      cursor += 1;
    }
    return groupingDepth === 0 ? deletions : null;
  }

  function getVisibleClozeText(value, deletions) {
    const text = String(value || "");
    const hiddenRanges = [];
    for (const deletion of deletions || []) {
      hiddenRanges.push([deletion.start, deletion.contentStart], [deletion.end - 2, deletion.end]);
    }
    hiddenRanges.sort((left, right) => left[0] - right[0]);
    let visible = "";
    let cursor = 0;
    for (const [start, end] of hiddenRanges) {
      if (start < cursor) continue;
      visible += text.slice(cursor, start);
      cursor = end;
    }
    return visible + text.slice(cursor);
  }

  function cleanClozeCompletionText(raw) {
    if (!raw) return "";
    let text = String(raw)
      .replace(/^[\s\u200b]+|[\s\u200b]+$/gu, "")
      .replace(/^['"`]+|['"`]+$/gu, "")
      .replace(/\r?\n+/gu, " ")
      .replace(/\s{2,}/gu, " ")
      .trim()
      .replace(/^(?:front|back|question|answer|completion)\s*[:\-]\s*/iu, "")
      .replace(/^(?:the\s+)?(?:answer|completion)\s+(?:is|would be|should be)\s+/iu, "")
      .replace(/^["'`]+|["'`]+$/gu, "")
      .trim();
    if (!text) return "";
    const startsWithMeta = /^(?:the user\b|i\b|we\b|looking at\b|based on\b|this (?:card|front|back|source)\b|the (?:front|back|source)\b)/iu.test(text);
    if (!startsWithMeta) return text;
    const labelled = text.match(/\b(?:answer|back|completion)\s*[:\-]\s*["“]?(.+?)["”]?$/iu);
    if (labelled?.[1] && !/^(?:the user\b|i\b|looking at\b)/iu.test(labelled[1].trim())) {
      return labelled[1].trim();
    }
    return "";
  }

  function hasClozeTargetDrift(existingText, fullText, deletions) {
    const prefix = String(existingText || "").trim().toLocaleLowerCase();
    if (!prefix || !Array.isArray(deletions) || !deletions.length) return false;
    const firstDeletion = [...deletions].sort((left, right) => left.start - right.start)[0];
    const visibleBeforeDeletion = String(fullText || "")
      .slice(String(existingText || "").length, firstDeletion.start)
      .replace(/[^\p{L}\p{N}$€£¥]+/gu, " ")
      .trim();
    const deletion = String(firstDeletion.content || "").trim();

    // If a user has already typed a duration-taking relation, leaving a complete
    // duration visible and blanking later trivia changes what the card tests. The
    // "took place" idiom remains valid because it does not expose a duration.
    if (/\b(?:took|lasted)$/u.test(prefix)) {
      const numberWord = "(?:\\d+(?:[.,]\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|many|few)";
      const durationUnit = "(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|decades?|centuries?)";
      if (new RegExp(`\\b${numberWord}\\s+${durationUnit}\\b`, "iu").test(visibleBeforeDeletion)) {
        return true;
      }
    }

    // A trailing temporal/place preposition cannot be completed by a monetary
    // amount. This catches source-order drift such as "funded in $40 million"
    // while allowing years, places, and durations ("in three annual rounds").
    if (/\b(?:in|on|at|during)$/u.test(prefix)) {
      const monetaryAnswer = /^(?:[$€£¥]\s*\d|(?:usd|aud|cad|nzd|eur|gbp|jpy)\b|\d[\d.,]*\s+(?:dollars?|euros?|pounds?|yen)\b)/iu;
      if (monetaryAnswer.test(deletion)) return true;
    }

    return false;
  }

  function validateClozeCompletion(
    existingText,
    completionText,
    {
      maxFrontWords = 18,
      maxDeletions = Number.POSITIVE_INFINITY,
      requiredNewDeletions = null,
    } = {}
  ) {
    const classification = classifyFrontCompletion(existingText, completionText);
    const result = {
      suffix: "",
      reason: "",
      classification,
      fullText: "",
      deletionCount: 0,
      newDeletionCount: 0,
      visibleWordCount: 0,
    };
    if (classification === "empty") return { ...result, reason: "empty" };
    if (classification === "partial-repeat" || classification === "prefix-drift") {
      return { ...result, reason: classification };
    }
    const suffix = (classification === "exact-repeat"
      ? stripExactRepeatedPrefix(existingText, completionText)
      : String(completionText || "")).trim();
    if (!suffix) return { ...result, reason: "empty" };
    const existing = String(existingText || "");
    const full = `${existing}${existing && !/\s$/u.test(existing) ? " " : ""}${suffix}`.trim();
    const deletions = parseClozeDeletions(full);
    if (deletions === null) {
      return { ...result, fullText: full, reason: "malformed-cloze" };
    }
    if (!deletions.length) {
      return { ...result, fullText: full, reason: "missing-deletion" };
    }
    const visibleText = getVisibleClozeText(full, deletions);
    const visibleWordCount = wordCount(visibleText);
    const deletionCount = deletions.length;
    const existingDeletions = parseClozeDeletions(existing) || [];
    const newDeletionCount = Math.max(0, deletionCount - existingDeletions.length);
    const newDeletions = deletions.filter((deletion) => deletion.start >= existing.length);
    const detail = { ...result, fullText: full, deletionCount, newDeletionCount, visibleWordCount };
    if (Number.isFinite(Number(maxFrontWords)) && visibleWordCount > Number(maxFrontWords)) {
      return { ...detail, reason: "over-word-cap" };
    }
    if (Number.isFinite(Number(maxDeletions)) && deletionCount > Number(maxDeletions)) {
      return { ...detail, reason: "too-many-deletions" };
    }
    if (Number.isInteger(requiredNewDeletions) && newDeletionCount !== requiredNewDeletions) {
      return {
        ...detail,
        reason: newDeletionCount < requiredNewDeletions
          ? "missing-new-deletion"
          : "too-many-new-deletions",
      };
    }
    if (hasClozeTargetDrift(existing, full, newDeletions)) {
      return { ...detail, reason: "target-drift" };
    }
    return { ...detail, suffix };
  }

  function normalizeClozeSuffix(existingText, completionText, options = {}) {
    return validateClozeCompletion(existingText, completionText, options).suffix;
  }

  function buildClozeGuardRetryPrompt(
    basePrompt,
    rejectedDraft,
    validation,
    { maxFrontWords = 18, maxDeletions = 1 } = {}
  ) {
    const reason = String(validation?.reason || "");
    const reasonText = {
      "partial-repeat": "The response only repeated part or all of the Prefix.",
      "prefix-drift": "The response restarted or changed the exact Prefix instead of continuing it.",
      "malformed-cloze": "The response contained incomplete or malformed Anki cloze markup.",
      "missing-deletion": "The response did not contain an Anki cloze deletion.",
      "missing-new-deletion": "The response did not add the one new Anki cloze deletion requested after the Prefix.",
      "too-many-new-deletions": "The response added more than one new Anki cloze deletion after the Prefix.",
      "over-word-cap": `The response exceeded the ${maxFrontWords}-word limit.`,
      "too-many-deletions": `The response used more than ${maxDeletions} new cloze deletion.`,
      "target-drift": "The response left the fact that completes the Prefix visible or hid a fact that does not fit its final relation.",
    }[reason] || "The response could not be inserted safely.";
    const clip = (value, max = 320) => {
      const text = String(value || "").replace(/\s+/gu, " ").trim();
      return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
    };
    const base = String(basePrompt || "").trim().replace(/\nOutput:\s*$/iu, "");
    const rewriteWordLimit = reason === "over-word-cap"
      ? Math.max(8, Number(maxFrontWords) - 2)
      : maxFrontWords;
    return [
      base,
      "",
      "Quality check: the previous Cloze completion was rejected.",
      `Reason: ${reasonText}`,
      rejectedDraft ? `Rejected output: ${clip(rejectedDraft)}` : "",
      `Rewrite once as one source-grounded sentence of at most ${rewriteWordLimit} words.`,
      reason === "over-word-cap"
        ? `The ${maxFrontWords}-word insertion maximum is hard; the smaller rewrite target leaves a safety margin. Discard nonessential Source wording, paraphrase compactly, and count every visible word.`
        : "",
      `Add exactly one new deletion in {{c1::answer}} format (at most ${maxDeletions} total in the completed text).`,
      "If the answer is a coordinated list, keep the complete list inside one deletion; never split its items across c1/c2.",
      "Put the answer to the Prefix's final relation inside the deletion; do not leave that answer visible or hide a later fact.",
      "Continue the exact Prefix without repeating, correcting, or restarting it.",
      "Output:",
    ].filter(Boolean).join("\n");
  }

  function normalizeWords(value) {
    return String(value || "")
      .toLocaleLowerCase()
      .replace(/[“”]/gu, '"')
      .replace(/[‘’`]/gu, "'")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function containsTokenPhrase(value, phrase) {
    const haystack = ` ${normalizeWords(value)} `;
    const needle = normalizeWords(phrase);
    return !!needle && haystack.includes(` ${needle} `);
  }

  function splitSourceSentences(value) {
    let remaining = String(value || "").trim();
    const sentences = [];
    // firstSourceSentence already protects the abbreviations used by the local
    // split feature. Reusing it here also prevents a fact such as "France London"
    // from becoming "contiguous" merely because punctuation normalizes to a space.
    for (let guard = 0; remaining && guard < 100; guard += 1) {
      const sentence = firstSourceSentence(remaining);
      if (!sentence) break;
      sentences.push(sentence);
      if (sentence.length >= remaining.length) break;
      const next = remaining
        .slice(sentence.length)
        .replace(/^\s*[.!?]+/u, "")
        .replace(/^\s+/u, "");
      if (!next || next.length >= remaining.length) break;
      remaining = next;
    }
    return sentences;
  }

  const DISPLAY_MATH_BLOCK_RE = /\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\begin\{(equation\*?|align\*?|aligned|gather\*?|multline\*?)\}[\s\S]*?\\end\{\1\}/gu;
  const MATH_SEGMENT_RE = /\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\begin\{(equation\*?|align\*?|aligned|gather\*?|multline\*?)\}[\s\S]*?\\end\{\1\}|\\\([\s\S]*?\\\)|\$[^$\n]+?\$/gu;
  const BARE_MATH_OPERAND_SOURCE = String.raw`(?:[+\-−]\s*)?(?:(?:\\[A-Za-z]+|[\p{L}\p{N}]+)(?:_\{?[\p{L}\p{N}]+\}?)?(?:\s*\([^?!,;:\n]*\))?(?:\s*\^\{?[\p{L}\p{N}+\-]+\}?)?|\([^?!,;:\n]+\)(?:\s*\^\{?[\p{L}\p{N}+\-]+\}?)?)`;
  const BARE_MATH_OPERATOR_SOURCE = String.raw`(?:\\(?:approx|cdot|circ|coloneqq|cup|div|equiv|geq?|gt|in|land|leq?|lor|lt|mapsto|mp|neq|notin|oplus|otimes|parallel|perp|pm|sim|subseteq?|supseteq?|times|to)\b|:=|≔|[\p{Sm}=+\-−*/<>])`;
  const BARE_MATH_EXPRESSION_RE = new RegExp(
    `${BARE_MATH_OPERAND_SOURCE}\\s*${BARE_MATH_OPERATOR_SOURCE}`
      + `(?:\\s*${BARE_MATH_OPERAND_SOURCE}`
      + `(?:\\s*${BARE_MATH_OPERATOR_SOURCE}\\s*${BARE_MATH_OPERAND_SOURCE})*)?`,
    "gu"
  );
  const MATH_LINK_BRIDGES = new Set([
    "hence", "let", "so", "suppose", "then", "therefore", "thus",
  ]);
  const NON_IDENTIFIER_MATH_COMMANDS = new Set([
    "begin", "big", "bigg", "biggl", "biggr", "bigl", "bigr", "cdot", "dfrac", "displaystyle",
    "end", "frac", "gather", "land", "left", "lor", "mathbb", "mathbf", "mathcal", "mathit",
    "mathrm", "multline", "operatorname", "overline", "right", "sqrt", "text", "textbf", "textit",
    "textrm", "tfrac", "times", "underline",
  ]);

  function splitSourceGroundingUnits(value) {
    const source = String(value || "").trim();
    if (!source) return [];
    const units = [];
    let cursor = 0;
    DISPLAY_MATH_BLOCK_RE.lastIndex = 0;
    let match;
    while ((match = DISPLAY_MATH_BLOCK_RE.exec(source))) {
      units.push(...splitSourceSentences(source.slice(cursor, match.index)));
      const display = match[0].trim();
      if (display) units.push(...splitDisplayMathBlock(display));
      cursor = DISPLAY_MATH_BLOCK_RE.lastIndex;
    }
    units.push(...splitSourceSentences(source.slice(cursor)));
    return units.filter(Boolean);
  }

  function isMathLikeFact(value) {
    const text = String(value || "").trim();
    return /^[+\-−]\s*(?:\d|\.\d|\\?[A-Za-z]|\p{L})/u.test(text)
      || /\\(?:[()[\]]|[A-Za-z]+)|[\p{Sm}_^=]|(?:[\p{L}\p{N})])\s*[+\-*/−]\s*(?:[\p{L}\p{N}(])/u.test(text);
  }

  function normalizeMathExpression(value) {
    let text = String(value || "").normalize("NFKC").toLocaleLowerCase();
    text = text
      .replace(/\\begin\{[^{}]+\}|\\end\{[^{}]+\}/gu, "")
      .replace(/\\[()[\]]|\${1,2}/gu, "")
      .replace(/\\(?:coloneqq|coloneq)\b|:=|≔/gu, "=")
      .replace(/\\(?:left|right|displaystyle)\b/gu, "")
      .replace(/\\(?:mathrm|mathbf|mathbb|mathcal|mathit|operatorname|text|textbf|textit|textrm)\s*\{([^{}]*)\}/gu, "$1")
      .replace(/\\([A-Za-z]+)/gu, "$1")
      .replace(/\\[,;:! ]/gu, "")
      .replace(/[{}]/gu, "")
      .replace(/−/gu, "-")
      .replace(/\s+/gu, "");
    return text.replace(/[^\p{L}\p{N}\p{Sm}_^=+\-*/().,:<>|]/gu, "");
  }

  function areGroundingFactsEquivalent(left, right) {
    const leftFact = cleanFactCandidate(left);
    const rightFact = cleanFactCandidate(right);
    if (!leftFact || !rightFact) return false;
    if (isMathLikeFact(leftFact) || isMathLikeFact(rightFact)) {
      return normalizeMathExpression(leftFact) === normalizeMathExpression(rightFact);
    }
    return containsTokenPhrase(leftFact, rightFact)
      && containsTokenPhrase(rightFact, leftFact);
  }

  function containsMathExpression(value, phrase) {
    const haystack = normalizeMathExpression(value);
    const needle = normalizeMathExpression(phrase);
    if (!needle) return false;
    let offset = 0;
    while (offset <= haystack.length - needle.length) {
      const index = haystack.indexOf(needle, offset);
      if (index === -1) return false;
      const before = haystack[index - 1] || "";
      const after = haystack[index + needle.length] || "";
      const beginsWithAtom = /^[\p{L}\p{N}_]/u.test(needle);
      const endsWithAtom = /[\p{L}\p{N}_]$/u.test(needle);
      if ((!beginsWithAtom || !/[\p{L}\p{N}_]/u.test(before))
          && (!endsWithAtom || !/[\p{L}\p{N}_]/u.test(after))) {
        return true;
      }
      offset = index + 1;
    }
    return false;
  }

  function containsSignedNumericFact(value, fact) {
    const source = String(value || "").normalize("NFKC");
    const descriptor = getSignedNumericValueDescriptor(fact);
    if (!descriptor) return false;
    const needle = descriptor.number;
    const isAtom = (char) => /[\p{L}\p{N}_]/u.test(char || "");
    for (let offset = 0; offset <= source.length - needle.length;) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return false;
      const before = source[index - 1] || "";
      const after = source[index + needle.length] || "";
      const decimalBefore = /[.,]/u.test(before) && /\d/u.test(source[index - 2] || "");
      const decimalAfter = /[.,]/u.test(after) && /\d/u.test(source[index + needle.length + 1] || "");
      if (!isAtom(before)
          && (!isAtom(after) || !!descriptor.suffix)
          && !decimalBefore
          && !decimalAfter) {
        let valueStart = index;
        let currencyIndex = index - 1;
        while (currencyIndex >= 0 && /\s/u.test(source[currencyIndex])) currencyIndex -= 1;
        if (descriptor.currency) {
          if (source[currencyIndex] !== descriptor.currency) {
            offset = index + 1;
            continue;
          }
          valueStart = currencyIndex;
        } else if (/[$€£¥]/u.test(source[currencyIndex] || "")) {
          valueStart = currencyIndex;
        }
        if (descriptor.suffix) {
          const following = normalizeWords(source.slice(index + needle.length, index + needle.length + 120));
          if (following !== descriptor.suffix && !following.startsWith(`${descriptor.suffix} `)) {
            offset = index + 1;
            continue;
          }
        }
        const sourceSuffixSymbols = getLeadingValueSuffixSymbols(
          source.slice(index + needle.length, index + needle.length + 16)
        );
        if (descriptor.suffixSymbols && sourceSuffixSymbols !== descriptor.suffixSymbols) {
          offset = index + 1;
          continue;
        }

        let signIndex = valueStart - 1;
        while (signIndex >= 0 && /\s/u.test(source[signIndex])) signIndex -= 1;
        const sign = (source[signIndex] || "").replace(/−/u, "-");
        if (sign !== descriptor.sign) {
          offset = index + 1;
          continue;
        }
        const prior = source[signIndex - 1] || "";
        if (!isAtom(prior)) return true;
      }
      offset = index + 1;
    }
    return false;
  }

  function getMathSegmentRanges(value) {
    const ranges = [];
    MATH_SEGMENT_RE.lastIndex = 0;
    let match;
    while ((match = MATH_SEGMENT_RE.exec(String(value || "")))) {
      ranges.push([match.index, MATH_SEGMENT_RE.lastIndex]);
    }
    return ranges;
  }

  function signHasBinaryLeftOperand(source, signIndex, mathRanges) {
    let priorIndex = signIndex - 1;
    while (priorIndex >= 0 && /\s/u.test(source[priorIndex])) priorIndex -= 1;
    const prior = source[priorIndex] || "";
    const insideMath = mathRanges.some(([start, end]) => signIndex >= start && signIndex < end);
    if (/[)\]}]/u.test(prior) || /\d/u.test(prior)) return true;
    if (insideMath && /[\p{L}\p{N}_]/u.test(prior)) return true;
    if (/[\p{L}_]/u.test(prior)) {
      let tokenStart = priorIndex;
      while (tokenStart > 0 && /[\p{L}\p{N}_\\]/u.test(source[tokenStart - 1])) tokenStart -= 1;
      const token = source.slice(tokenStart, priorIndex + 1).replace(/^\\/u, "");
      return token.length === 1 || /[\p{N}_]/u.test(token);
    }
    return false;
  }

  function getUnsignedNumericValueDescriptor(fact) {
    const raw = String(fact || "").normalize("NFKC").trim();
    const match = raw.match(/^([$€£¥])?\s*(\d+(?:[.,]\d+)?)([\s\S]*)$/u);
    if (!match) return null;
    return {
      currency: match[1] || "",
      number: match[2],
      suffix: normalizeWords(match[3]),
      suffixSymbols: getLeadingValueSuffixSymbols(match[3]),
    };
  }

  function getLeadingValueSuffixSymbols(value) {
    return String(value || "").normalize("NFKC").match(/^\s*([%‰°]+)/u)?.[1] || "";
  }

  function getSignedNumericValueDescriptor(fact) {
    const raw = String(fact || "").normalize("NFKC").trim();
    const match = raw.match(/^([+\-−])\s*([$€£¥])?\s*(\d+(?:[.,]\d+)?)([\s\S]*)$/u);
    if (!match) return null;
    return {
      sign: match[1].replace(/−/u, "-"),
      currency: match[2] || "",
      number: match[3],
      suffix: normalizeWords(match[4]),
      suffixSymbols: getLeadingValueSuffixSymbols(match[4]),
    };
  }

  function containsUnsignedNumericFact(value, fact) {
    const source = String(value || "").normalize("NFKC");
    const descriptor = getUnsignedNumericValueDescriptor(fact);
    if (!descriptor) return false;
    const needle = descriptor.number;
    const isAtom = (char) => /[\p{L}\p{N}_]/u.test(char || "");
    const mathRanges = getMathSegmentRanges(source);
    for (let offset = 0; offset <= source.length - needle.length;) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return false;
      const before = source[index - 1] || "";
      const after = source[index + needle.length] || "";
      const decimalBefore = /[.,]/u.test(before) && /\d/u.test(source[index - 2] || "");
      const decimalAfter = /[.,]/u.test(after) && /\d/u.test(source[index + needle.length + 1] || "");
      if (!isAtom(before)
          && (!isAtom(after) || !!descriptor.suffix)
          && !decimalBefore
          && !decimalAfter) {
        let valueStart = index;
        let currencyIndex = index - 1;
        while (currencyIndex >= 0 && /\s/u.test(source[currencyIndex])) currencyIndex -= 1;
        if (descriptor.currency) {
          if (source[currencyIndex] !== descriptor.currency) {
            offset = index + 1;
            continue;
          }
          valueStart = currencyIndex;
        } else if (/[$€£¥]/u.test(source[currencyIndex] || "")) {
          valueStart = currencyIndex;
        }
        if (descriptor.suffix) {
          const following = normalizeWords(source.slice(index + needle.length, index + needle.length + 120));
          if (following !== descriptor.suffix && !following.startsWith(`${descriptor.suffix} `)) {
            offset = index + 1;
            continue;
          }
        }
        const sourceSuffixSymbols = getLeadingValueSuffixSymbols(
          source.slice(index + needle.length, index + needle.length + 16)
        );
        if (descriptor.suffixSymbols && sourceSuffixSymbols !== descriptor.suffixSymbols) {
          offset = index + 1;
          continue;
        }

        let signIndex = valueStart - 1;
        while (signIndex >= 0 && /\s/u.test(source[signIndex])) signIndex -= 1;
        const sign = source[signIndex] || "";
        if (!/[+\-−]/u.test(sign)) return true;
        if (signHasBinaryLeftOperand(source, signIndex, mathRanges)) return true;
      }
      offset = index + 1;
    }
    return false;
  }

  function groundingUnitContainsFact(unit, fact) {
    return getSignedNumericValueDescriptor(fact)
      ? containsSignedNumericFact(unit, fact)
      : isMathLikeFact(fact)
      ? sourceContainsMathExpression(unit, fact)
      : getUnsignedNumericValueDescriptor(fact)
        ? containsUnsignedNumericFact(unit, fact)
      : containsTokenPhrase(unit, fact);
  }

  function factGroundingKey(value) {
    return isMathLikeFact(value)
      ? `math:${normalizeMathExpression(value)}`
      : `text:${normalizeWords(value)}`;
  }

  function cleanFactCandidate(value) {
    return String(value || "")
      .replace(/\s+/gu, " ")
      .trim()
      // Remove a real list marker, but never strip a bare numeric answer such as 1991.
      .replace(/^(?:[-•*]\s+|\d{1,2}[.)]\s+)/u, "")
      .trim();
  }

  function isSourceGroundedFact(sourceText, fact) {
    const clean = cleanFactCandidate(fact);
    if (!clean) return false;
    return splitSourceGroundingUnits(sourceText)
      .some((unit) => groundingUnitContainsFact(unit, clean));
  }

  function filterSourceGroundedFacts(sourceText, candidates, {
    maxFacts = 8,
    maxLength = 80,
  } = {}) {
    const facts = [];
    const seen = new Set();
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const clean = cleanFactCandidate(candidate);
      const key = factGroundingKey(clean);
      if (!clean || clean.length > maxLength || !key || seen.has(key)) continue;
      if (!isSourceGroundedFact(sourceText, clean)) continue;
      seen.add(key);
      facts.push(clean);
      if (facts.length >= maxFacts) break;
    }
    return facts;
  }

  function groundingTokenVariants(value) {
    const token = normalizeWords(value);
    const variants = new Set(token ? [token] : []);
    if (!token || /\s/u.test(token) || /\p{N}/u.test(token)) return variants;
    const irregular = CARD_GROUNDING_IRREGULAR_FORMS.get(token);
    if (irregular) variants.add(irregular);
    if (token.length > 4 && token.endsWith("ies")) variants.add(`${token.slice(0, -3)}y`);
    if (token.length > 5 && token.endsWith("ing")) {
      const base = token.slice(0, -3);
      variants.add(base);
      variants.add(`${base}e`);
      if (/(.)\1$/u.test(base)) variants.add(base.slice(0, -1));
    }
    if (token.length > 4 && token.endsWith("ed")) {
      const base = token.slice(0, -2);
      variants.add(base);
      variants.add(`${base}e`);
      if (/(.)\1$/u.test(base)) variants.add(base.slice(0, -1));
    }
    if (token.length > 4 && token.endsWith("es")) variants.add(token.slice(0, -2));
    if (token.length > 3 && token.endsWith("s")) variants.add(token.slice(0, -1));
    return variants;
  }

  function getAnswerShapeGlueWords(answer) {
    const raw = String(answer || "").trim();
    const normalized = normalizeWords(raw);
    const allowed = new Set();
    if (/^(?:1[5-9]|20)\d{2}$/u.test(normalized)) {
      allowed.add("date");
      allowed.add("year");
    }
    if (/(?:[$€£¥]\s*\d|\b(?:usd|aud|cad|nzd|eur|gbp|jpy)\b|\b\d[\d,.]*\s+(?:dollars?|euros?|pounds?|yen)\b)/iu.test(raw)) {
      allowed.add("amount");
    }
    if (/^\d[\d,.]*$/u.test(normalized)) allowed.add("number");
    if (/\b(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|decades?|centuries?)\b/iu.test(raw)) {
      allowed.add("duration");
    }
    return allowed;
  }

  function getGroundingContentTokens(value, { answer = "" } = {}) {
    const answerShapeGlue = getAnswerShapeGlueWords(answer);
    return normalizeWords(value)
      .split(" ")
      .filter(Boolean)
      .filter((token) => !CARD_GROUNDING_GLUE_WORDS.has(token))
      .filter((token) => !answerShapeGlue.has(token));
  }

  function removeClozeDeletions(value, deletions) {
    const text = String(value || "");
    const outer = [...(deletions || [])]
      .sort((left, right) => left.start - right.start)
      .filter((deletion, index, all) => !all.some((other, otherIndex) => (
        otherIndex !== index && other.start <= deletion.start && other.end >= deletion.end
      )));
    let visible = "";
    let cursor = 0;
    for (const deletion of outer) {
      visible += `${text.slice(cursor, deletion.start)} `;
      cursor = deletion.end;
    }
    return visible + text.slice(cursor);
  }

  function getSourceNotationGlueWords(value) {
    const source = String(value || "");
    const allowed = new Set();
    if (/\\Pr(?:\b|_)|\\mathbb\s*\{\s*P\s*\}/u.test(source)) {
      allowed.add("probability");
      allowed.add("probabilities");
    }
    if (/=|:=|\\coloneqq|\\equiv|≔|≡/u.test(source)) {
      allowed.add("equal");
      allowed.add("equals");
      allowed.add("value");
    }
    return allowed;
  }

  function sentenceSupportsGroundingContext(sentence, contextTokens, contextText = "") {
    const notationGlue = getSourceNotationGlueWords(sentence);
    const contextIdentifiers = getDistinctiveMathIdentifiers(contextText, { includeSingle: true });
    const sourceIdentifiers = getDistinctiveMathIdentifiers(sentence, { includeSingle: true });
    if ([...contextIdentifiers].some((identifier) => !sourceIdentifiers.has(identifier))) {
      return false;
    }
    const contextMath = getGroundingMathSegments(contextText);
    if (contextMath.some((segment) => !sourceContainsMathExpression(sentence, segment))) {
      return false;
    }
    const sourceVariants = new Set();
    for (const token of normalizeWords(sentence).split(" ").filter(Boolean)) {
      for (const variant of groundingTokenVariants(token)) sourceVariants.add(variant);
    }
    return contextTokens.every((token) => (
      notationGlue.has(token)
      || [...groundingTokenVariants(token)].some((variant) => sourceVariants.has(variant))
    ));
  }

  function isDisplayMathUnit(value) {
    return /^(?:\\\[|\$\$|\\begin\{(?:equation\*?|align\*?|aligned|gather\*?|multline\*?)\})/u
      .test(String(value || "").trim());
  }

  function getDisplayMathBody(value) {
    const display = String(value || "").trim();
    if (display.startsWith("\\[") && display.endsWith("\\]")) {
      return display.slice(2, -2);
    }
    if (display.startsWith("$$") && display.endsWith("$$")) {
      return display.slice(2, -2);
    }
    const environment = display.match(
      /^\\begin\{(equation\*?|align\*?|aligned|gather\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}$/u
    );
    return environment ? environment[2] : display;
  }

  function isMathContinuationRow(value) {
    return /^(?:&?\s*)?(?:=|:=|≔|≡|≤|≥|≠|≈|∼|[+\-−*/]|\\(?:approx|cdot|equiv|geq?|leq?|mp|neq|pm|sim|times)\b)/u
      .test(String(value || "").trim());
  }

  function splitDisplayMathBlock(value) {
    const body = getDisplayMathBody(value);
    const rows = body
      // A raw newline is only whitespace in TeX and often wraps one expression.
      // Only an explicit `\\` starts a new mathematical row.
      .split(/\\\\(?:\s*\[[^\]]*\])?\s*/u)
      .map((row) => row.trim())
      .filter(Boolean);
    if (rows.length <= 1) return value ? [String(value).trim()] : [];

    const groups = [];
    let current = [];
    for (const row of rows) {
      if (!current.length || isMathContinuationRow(row)) {
        current.push(row);
        continue;
      }
      groups.push(current.join("\n"));
      current = [row];
    }
    if (current.length) groups.push(current.join("\n"));
    return groups.map((group) => `\\[\n${group}\n\\]`);
  }

  function getMathSegments(value) {
    const text = String(value || "");
    const segments = [];
    MATH_SEGMENT_RE.lastIndex = 0;
    let match;
    while ((match = MATH_SEGMENT_RE.exec(text))) segments.push(match[0]);
    return segments;
  }

  function getBareMathExpressions(value) {
    MATH_SEGMENT_RE.lastIndex = 0;
    const unwrappedText = String(value || "").replace(MATH_SEGMENT_RE, (segment) => " ".repeat(segment.length));
    BARE_MATH_EXPRESSION_RE.lastIndex = 0;
    return (unwrappedText.match(BARE_MATH_EXPRESSION_RE) || [])
      .map((expression) => expression.trim())
      // Treat ordinary compounds as prose, while retaining single-letter
      // identifiers such as x-y and numeric ranges as mathematical relations.
      .filter((expression) => !/^\p{L}{2,}(?:\s*-\s*\p{L}{2,})+$/u.test(expression));
  }

  function getGroundingMathSegments(value) {
    return [...getMathSegments(value), ...getBareMathExpressions(value)];
  }

  function sourceContainsMathExpression(value, expression) {
    const segments = getGroundingMathSegments(value);
    const candidates = segments.length ? segments : [String(value || "")];
    return candidates.some((segment) => containsMathExpression(segment, expression));
  }

  function getDistinctiveMathIdentifiers(value, { includeSingle = false } = {}) {
    const identifiers = new Set();
    for (const segment of getGroundingMathSegments(value)) {
      const commandIdentifiers = [];
      // When an outer display block contains an aligned environment, row
      // splitting can leave a begin/end marker on either side. Remove the
      // complete marker first so the environment name cannot falsely link two
      // otherwise independent rows.
      const withoutEnvironments = segment.replace(/\\(?:begin|end)\{[^{}]+\}/gu, " ");
      const withoutCommands = withoutEnvironments.replace(
        /\\([A-Za-z]+)(?:_\{?([\p{L}\p{N}]+)\}?)?/gu,
        (full, command, subscript) => {
          const name = String(command || "").toLocaleLowerCase();
          if (!NON_IDENTIFIER_MATH_COMMANDS.has(name)) {
            commandIdentifiers.push(subscript ? `${name}_${subscript}` : name);
          }
          return " ";
        }
      );
      const rawIdentifiers = withoutCommands.match(
        /[\p{L}][\p{L}\p{N}]*(?:_\{?[\p{L}\p{N}]+\}?)?/gu
      ) || [];
      for (const raw of [...commandIdentifiers, ...rawIdentifiers]) {
        const identifier = String(raw || "")
          .toLocaleLowerCase()
          .replace(/[{}]/gu, "");
        if (includeSingle
            || identifier.length > 1
            || identifier.includes("_")
            || /\p{N}/u.test(identifier)) {
          identifiers.add(identifier);
        }
      }
    }
    return identifiers;
  }

  function setsIntersect(left, right) {
    for (const value of left) {
      if (right.has(value)) return true;
    }
    return false;
  }

  function isMathLinkBridge(value) {
    return MATH_LINK_BRIDGES.has(normalizeWords(value));
  }

  function getAnswerGroundingSupport(units, answerIndex) {
    const answerUnit = units[answerIndex];
    if (!isDisplayMathUnit(answerUnit)) return answerUnit;

    const support = [answerUnit];
    const linkedIdentifiers = getDistinctiveMathIdentifiers(answerUnit);
    if (!linkedIdentifiers.size) return answerUnit;

    // A derivation may depend on a nearby setup paragraph split from its display
    // block by a short transition ("Then"). Walk only a few preceding logical
    // units, and admit a unit only when its mathematical identifiers overlap the
    // already-linked derivation. This deliberately avoids whole-source vocabulary
    // fallback, which could pair an answer with an unrelated fact elsewhere.
    for (let index = answerIndex - 1, inspected = 0;
      index >= 0 && inspected < 4;
      index -= 1, inspected += 1) {
      const candidate = units[index];
      const candidateIdentifiers = getDistinctiveMathIdentifiers(candidate);
      if (!candidateIdentifiers.size) {
        if (isMathLinkBridge(candidate)) continue;
        break;
      }
      if (!setsIntersect(linkedIdentifiers, candidateIdentifiers)) break;
      support.unshift(candidate);
      for (const identifier of candidateIdentifiers) linkedIdentifiers.add(identifier);
    }
    return support.join("\n");
  }

  function getCardSourceGroundingIssue(cardText, {
    sourceText = "",
    answer = "",
    cloze = false,
  } = {}) {
    const source = String(sourceText || "").trim();
    const selectedAnswer = cleanFactCandidate(answer);
    if (!source || !selectedAnswer || !isSourceGroundedFact(source, selectedAnswer)) {
      return "Selected answer is not a contiguous phrase in the Source";
    }

    let context = String(cardText || "").trim();
    if (cloze) {
      const deletions = parseClozeDeletions(context);
      if (!Array.isArray(deletions) || deletions.length !== 1) {
        return "Cloze context could not be checked against the Source";
      }
      context = removeClozeDeletions(context, deletions);
    }
    const contextTokens = getGroundingContentTokens(context, { answer: selectedAnswer });
    if (!contextTokens.length) return "Card has no source-grounded cue context";

    const groundingUnits = splitSourceGroundingUnits(source);
    const answerSupport = groundingUnits
      .map((unit, index) => ({ unit, index }))
      .filter(({ unit }) => groundingUnitContainsFact(unit, selectedAnswer))
      .map(({ index }) => getAnswerGroundingSupport(groundingUnits, index));
    if (answerSupport.some((support) => sentenceSupportsGroundingContext(support, contextTokens, context))) {
      return "";
    }
    return "Card adds context not present with the picked answer in the Source";
  }

  function extractAttributionTuples(sourceText) {
    const source = String(sourceText || "").replace(/\s+/gu, " ").trim();
    const tuples = [];
    const addTuple = (scope, answerWithDate) => {
      let answer = cleanSourcePiece(answerWithDate);
      let date = "";
      const dated = answer.match(/^([\s\S]*?)\s+in\s+((?:1[5-9]|20)\d{2})$/u);
      if (dated) {
        answer = cleanSourcePiece(dated[1]);
        date = dated[2];
      }
      const tuple = { scope: cleanSourcePiece(scope), answer, date };
      if (!tuple.answer) return;
      const key = [tuple.scope, tuple.answer, tuple.date].map(normalizeWords).join("|");
      if (!tuples.some((existing) => existing.key === key)) tuples.push({ ...tuple, key });
    };
    const boundary = "(?=\\s*(?:(?:[,;]\\s*(?:and\\s+)?|and\\s+)to\\b|[.;]|$))";
    const primary = new RegExp(
      `\\b(?:introduced|coined|named|called)\\b(?:\\s+to\\s+(.{2,90}?))?\\s+by\\s+(.{1,120}?)${boundary}`,
      "giu"
    );
    const continuation = new RegExp(
      `(?:^|[,;]\\s*(?:and\\s+)?|\\band\\s+)to\\s+(.{2,90}?)\\s+by\\s+(.{1,120}?)${boundary}`,
      "giu"
    );
    let match;
    while ((match = primary.exec(source))) addTuple(match[1] || "", match[2]);
    while ((match = continuation.exec(source))) addTuple(match[1] || "", match[2]);
    return tuples;
  }

  function getAttributionQualifierIssue(frontText, {
    sourceText = "",
    existingText = "",
    protectedAnswer = "",
  } = {}) {
    const front = String(frontText || "").replace(/\s+/gu, " ").trim();
    const source = String(sourceText || "").replace(/\s+/gu, " ").trim();
    const existing = normalizeWords(existingText);
    const normalizedFront = normalizeWords(front);
    if (!front || !source) return "";
    if (!/^(?:who|what|which)\b/u.test(existing) && !/^(?:who|what|which)\b/u.test(normalizedFront)) return "";
    if (!/\b(?:introduced|coined|named|called)\b/iu.test(front)) return "";

    const attribution = source.match(/\b(the\s+(?:term|phrase)|the\s+concept\s+of)\s+(.{1,100}?)\s+(?:was|were|is|are)\s+(introduced|coined|named|called)\b/iu);
    if (!attribution) return "";
    const qualifier = attribution[1].replace(/\s+/gu, " ").toLocaleLowerCase();
    const subject = cleanSourcePiece(attribution[2]);
    if (!containsTokenPhrase(front, subject)) return "";
    if (!containsTokenPhrase(front, qualifier)) {
      return `Front drops the source attribution qualifier "${qualifier}"`;
    }

    const tuples = extractAttributionTuples(source);
    const scopeMatches = tuples.map((tuple) => tuple.scope).filter(Boolean);
    const scopeRe = /(?:\bintroduced\s+)?\bto\s+(.{2,90}?)\s+by\b/giu;
    let scope;
    while ((scope = scopeRe.exec(source))) {
      const clean = cleanSourcePiece(scope[1]).replace(/^and\s+to\s+/iu, "");
      if (clean && !scopeMatches.some((value) => normalizeWords(value) === normalizeWords(clean))) {
        scopeMatches.push(clean);
      }
    }
    const dates = source.match(/\b(?:1[5-9]|20)\d{2}\b/gu) || [];
    const byCount = (source.match(/\bby\b/giu) || []).length;
    const hasMultipleAttributions = tuples.length >= 2
      || scopeMatches.length >= 2
      || (byCount >= 2 && dates.length >= 2);
    if (!hasMultipleAttributions) return "";

    const protectedText = String(protectedAnswer || "").trim();
    const protectedTuples = protectedText
      ? tuples.filter((tuple) => containsTokenPhrase(tuple.answer, protectedText)
        || containsTokenPhrase(protectedText, tuple.answer))
      : [];
    if (protectedTuples.length === 1) {
      const protectedTuple = protectedTuples[0];
      const correctDiscriminators = [protectedTuple.scope, protectedTuple.date].filter(Boolean);
      const conflictingDiscriminators = tuples
        .filter((tuple) => tuple !== protectedTuple)
        .flatMap((tuple) => [tuple.scope, tuple.date])
        .filter(Boolean);
      if (conflictingDiscriminators.some((value) => containsTokenPhrase(front, value))) {
        return "Front uses the scope or date from a different source attribution";
      }
      if (correctDiscriminators.length
          && !correctDiscriminators.some((value) => containsTokenPhrase(front, value))) {
        return "Front omits the scope or date tied to the protected answer";
      }
      return "";
    }

    const hasDiscriminator = scopeMatches.some((value) => containsTokenPhrase(front, value))
      || dates.some((value) => containsTokenPhrase(front, value));
    if (!hasDiscriminator) {
      return "Front omits the scope or date needed to distinguish multiple attributions";
    }
    return "";
  }

  // Deterministic counterpart to the qualifier guard above: the guard already knows the source's
  // qualifier and subject, so a Front that merely dropped (or swapped) the qualifier can be
  // repaired by splicing it back in — no model retry needed. Returns the repaired full Front,
  // or "" when the repair doesn't apply cleanly; the caller must re-validate the result.
  function repairFrontAttributionQualifier(frontText, { sourceText = "" } = {}) {
    const front = String(frontText || "").replace(/\s+/gu, " ").trim();
    const source = String(sourceText || "").replace(/\s+/gu, " ").trim();
    if (!front || !source) return "";
    const attribution = source.match(/\b(the\s+(?:term|phrase)|the\s+concept\s+of)\s+(.{1,100}?)\s+(?:was|were|is|are)\s+(?:introduced|coined|named|called)\b/iu);
    if (!attribution) return "";
    const qualifier = attribution[1].replace(/\s+/gu, " ").toLocaleLowerCase();
    const subject = cleanSourcePiece(attribution[2]);
    if (!subject || !containsTokenPhrase(front, subject)) return "";
    if (containsTokenPhrase(front, qualifier)) return "";
    const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const subjectPattern = subject.split(/\s+/u).map(escapeRe).join("\\s+");
    const re = new RegExp(`\\b(?:the\\s+(?:term|phrase)\\s+|the\\s+concept\\s+of\\s+)?(${subjectPattern})\\b`, "iu");
    const match = re.exec(front);
    if (!match) return "";
    const repaired = `${front.slice(0, match.index)}${qualifier} ${match[1]}${front.slice(match.index + match[0].length)}`;
    return repaired === front ? "" : repaired;
  }

  return {
    areGroundingFactsEquivalent,
    buildTextIndex,
    buildClozeGuardRetryPrompt,
    classifyFrontCompletion,
    cleanClozeCompletionText,
    containsTokenPhrase,
    filterSourceGroundedFacts,
    firstSourceSentence,
    getAttributionQualifierIssue,
    repairFrontAttributionQualifier,
    getCardSourceGroundingIssue,
    inferLiteralSourceSplit,
    isSourceGroundedFact,
    normalizeClozeSuffix,
    normalizeFrontSuffix,
    parseClozeDeletions,
    validateClozeCompletion,
    wordCount,
  };
});
