/* global module */

(function initGhostwriterMetadataFallback(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GHOSTWRITER_METADATA_FALLBACK = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildMetadataFallback() {
  "use strict";

  const DOMAIN_TERMS = Object.freeze({
    math: ["algebra", "calculus", "derivative", "equation", "geometry", "integral", "matrix", "theorem"],
    statistics: ["bayes", "confidence interval", "hypothesis test", "p value", "regression", "standard deviation", "statistical"],
    economics: ["economics", "elasticity", "inflation", "macroeconomic", "microeconomic", "supply and demand"],
    finance: ["asset pricing", "bond", "cash flow", "dividend", "financial", "interest rate", "portfolio"],
    "computer-science": ["algorithm", "computational complexity", "data structure", "operating system", "turing machine"],
    programming: ["bytecode", "compiler", "debugging", "function call", "programming language", "source code", "software", "syntax error"],
    ai: ["artificial intelligence", "deep learning", "gradient descent", "language model", "machine learning", "model weights", "neural network", "transformer model"],
    biology: ["cell membrane", "dna", "ecology", "enzyme", "evolution", "gene", "organism", "protein"],
    chemistry: ["chemical bond", "molecule", "oxidation", "periodic table", "reaction", "reagent", "stoichiometry"],
    physics: ["electromagnetic", "force", "kinetic energy", "momentum", "quantum", "thermodynamic", "velocity"],
    medicine: ["clinical", "diagnosis", "disease", "myocardial", "patient", "pharmacology", "symptom", "treatment"],
    law: ["breach", "causation", "constitutional", "contract law", "court", "duty", "negligence", "plaintiff", "statute", "tort law"],
    history: ["century", "empire", "historian", "historical", "revolution", "war"],
    philosophy: ["epistemology", "ethics", "metaphysics", "philosopher", "philosophical", "utilitarian"],
    language: ["conjugation", "definition", "translation", "vocabulary", "word meaning"],
    linguistics: ["grammar", "morpheme", "phoneme", "pragmatics", "semantics", "syntax"],
    literature: ["author", "literary", "metaphor", "novel", "poem", "protagonist"],
    psychology: ["behaviour", "cognition", "memory", "psychological", "recall"],
    sociology: ["inequality", "social class", "social institution", "sociological", "society"],
    engineering: ["control system", "engineering", "load bearing", "mechanical", "structural"],
    business: ["business model", "customer", "management", "marketing", "organisation", "strategy"],
    geography: ["cartography", "geographic", "landform", "latitude", "region"],
    "political-science": ["election", "government", "political party", "public policy", "voting"],
    "earth-science": ["climate", "geology", "mineral", "plate tectonic", "seismic"],
    astronomy: ["galaxy", "orbit", "planet", "solar system", "star", "telescope"],
    art: ["art history", "artist", "canvas", "painting", "sculpture"],
    music: ["chord", "harmony", "melody", "musical", "rhythm"],
    education: ["assessment", "curriculum", "learning objective", "pedagogy", "teaching"],
    anthropology: ["anthropological", "archaeology", "ethnography", "kinship", "material culture"],
  });

  const HOST_HINTS = Object.freeze({
    "github.com": "programming",
    "stackoverflow.com": "programming",
    "pubmed.ncbi.nlm.nih.gov": "medicine",
    "plato.stanford.edu": "philosophy",
    "law.cornell.edu": "law",
  });

  const CONTROLLED_DOMAINS = Object.freeze(Object.keys(DOMAIN_TERMS));
  const CONTROLLED_DOMAIN_SET = new Set(CONTROLLED_DOMAINS);

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeTagToken(value) {
    return normalizeText(value).replace(/\s+/g, "-");
  }

  function containsPhrase(normalizedText, phrase) {
    if (!normalizedText) return false;
    const needle = normalizeText(phrase);
    return !!needle && ` ${normalizedText} `.includes(` ${needle} `);
  }

  function readHostname(value) {
    try {
      return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function sanitizeAiSuggestedTags(suggestion = {}) {
    if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) return [];

    const domain = normalizeTagToken(suggestion.domain);
    if (!CONTROLLED_DOMAIN_SET.has(domain)) return [];

    const normalizeList = (value) => (Array.isArray(value) ? value : [value])
      .map(normalizeTagToken)
      .filter(Boolean);
    const subdomains = [...new Set(normalizeList(suggestion.subdomains))]
      .filter((tag) => tag !== domain)
      .slice(0, 3);
    const extras = [...new Set(normalizeList(suggestion.extras))]
      .filter((tag) => tag !== domain && !subdomains.includes(tag))
      .slice(0, 2);

    return [domain, ...subdomains, ...extras];
  }

  function classifyDomainTags({ front = "", back = "", title = "", url = "" } = {}) {
    const fields = [
      { text: normalizeText(`${front} ${back}`), weight: 2 },
      { text: normalizeText(title), weight: 1.5 },
    ];
    const scores = new Map(Object.keys(DOMAIN_TERMS).map((domain) => [domain, 0]));

    for (const [domain, terms] of Object.entries(DOMAIN_TERMS)) {
      let score = 0;
      for (const field of fields) {
        for (const term of terms) {
          if (containsPhrase(field.text, term)) score += field.weight;
        }
      }
      scores.set(domain, score);
    }

    const hostname = readHostname(url);
    for (const [host, domain] of Object.entries(HOST_HINTS)) {
      if (hostname === host || hostname.endsWith(`.${host}`)) {
        scores.set(domain, (scores.get(domain) || 0) + 1.5);
      }
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const [winner, runnerUp] = ranked;
    if (!winner || winner[1] < 5) return [];
    if (runnerUp && winner[1] - runnerUp[1] < 2) return [];
    return [normalizeTagToken(winner[0])];
  }

  return Object.freeze({
    CONTROLLED_DOMAINS,
    DOMAIN_TERMS,
    classifyDomainTags,
    normalizeTagToken,
    sanitizeAiSuggestedTags,
  });
});
