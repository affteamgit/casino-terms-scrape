// Pulls raw quotes out of footer and terms text by keyword. Best effort, not clean values: every quote is the
// sentence (or line) that matched, so a reviewer can read the casino's own wording.

const MAX_QUOTES = 6;
const MAX_LEN = 600;
// Restricted-country clauses are one long list; keep them whole.
const MAX_LEN_BY_RULE = { restricted: 3000 };

/** Sentences and short lines, trimmed and de-duplicated. */
export function sentences(text) {
  const parts = text
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?;])\s+(?=[A-Z0-9“"(])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 15);
  return [...new Set(parts)];
}

const has = (re) => (s) => re.test(s);
const all = (...res) => (s) => res.every((re) => re.test(s));

export const RULES = {
  licence: has(/licen[cs]e[ds]?\b|regulated by|gaming (authority|commission|control board)|cura[cç]ao egaming|antillephone|\bmga\b|malta gaming|kahnawake|tobique|anjouan|gaming control|gambling commission|gibraltar|isle of man|ALSI-|OGL\/|8048\/JAZ/i),
  owner: has(/owned (and|&) operated|operated by|is (owned|operated) by|registered (office|address|in|under)|company (registration|number|no)|registration (number|no)|\b(ltd|limited|b\.v\.|n\.v\.|s\.r\.l\.|srl|llc|inc\.?|gmbh|s\.a\.)(?=[\s,.)]|$)/i),
  withdrawal_limits: all(/withdraw|cash ?out|pay ?out/i, /\blimit|maximum|max\.?|minimum|min\.?|per (day|week|month|transaction)|daily|weekly|monthly|cap(ped)?\b/i),
  withdrawal_time: all(/withdraw|cash ?out|pay ?out|payment/i, /within|\b\d+\s*(hours?|hrs?|days?|business days|working days|banking days|minutes?)\b|processing time|processed (in|within)|instant/i),
  installments: has(/instal?lments?|partial payments?|divided? (the payout )?into|split (the payout )?into|monthly payments? of|paid out in (parts|portions)/i),
  kyc: has(/\bkyc\b|know your customer|verif(y|ication) (of )?(your )?(identity|account|documents)|proof of (identity|address|id)|source of (funds|wealth)|documents? (will be|may be|must be) (requested|required)/i),
  restricted: all(/restrict|prohibit|exclud|not (allowed|permitted|accepted|eligible)|forbidden|cannot (register|open|play)/i, /countr|jurisdiction|territor|residents?|citizens?/i),
};

/** Licence numbers in the formats the common regulators use. */
const LICENCE_PATTERNS = [
  /ALSI-\d{6,}-FI\d/gi, // Anjouan
  /OGL\/\d{4}\/\d+\/\d+/gi, // Curaçao Gaming Authority (new)
  /\b\d{4}\/JAZ\d*[-/]?\d*\b/gi, // Curaçao master licence (8048/JAZ...)
  /GLH-OCCHKTW\d+/gi, // Curaçao Antillephone style
  /MGA\/[A-Z0-9]+\/\d+\/\d{4}/gi, // Malta
  /\b(?:licen[cs]e|licence)\s*(?:no\.?|number|#|:)\s*[:#]?\s*([A-Z0-9][A-Z0-9/\-.]{3,30})/gi,
];

export function licenceNumbers(text) {
  const found = new Set();
  for (const re of LICENCE_PATTERNS) for (const m of text.matchAll(re)) found.add((m[1] || m[0]).replace(/[.,;:]+$/, ""));
  return [...found].slice(0, 6);
}

const JURISDICTIONS = [
  ["Curaçao", /cura[cç]ao/i], ["Anjouan", /anjouan/i], ["Malta", /\bmalta\b|\bmga\b/i], ["Tobique", /tobique/i],
  ["Kahnawake", /kahnawake/i], ["Costa Rica", /costa rica/i], ["Gibraltar", /gibraltar/i], ["Isle of Man", /isle of man/i],
  ["United Kingdom (UKGC)", /uk gambling commission|united kingdom gambling commission|ukgc/i], ["Mwali", /mwali|moh[eé]li/i],
  ["Estonia", /estonia/i], ["Sweden", /spelinspektionen/i], ["Kansspelautoriteit", /kansspelautoriteit/i],
];

/** Jurisdictions named in licence quotes (falls back to the whole footer). */
export function jurisdictions(quotes, footer) {
  const hay = quotes.join(" ") || footer;
  return JURISDICTIONS.filter(([, re]) => re.test(hay)).map(([n]) => n);
}

/** All quotes per rule, tagged with where they came from: [{ rule: [ "quote  ‹page›", ... ] }]. */
export function extract(docs) {
  const out = Object.fromEntries(Object.keys(RULES).map((k) => [k, []]));
  for (const { label, text } of docs) {
    for (const s of sentences(text)) {
      for (const [rule, test] of Object.entries(RULES)) {
        if (out[rule].length >= MAX_QUOTES) continue;
        if (test(s) && !out[rule].some((q) => q.startsWith(s.slice(0, 80)))) out[rule].push(`${s.slice(0, MAX_LEN_BY_RULE[rule] ?? MAX_LEN)} ‹${label}›`);
      }
    }
  }
  return out;
}
