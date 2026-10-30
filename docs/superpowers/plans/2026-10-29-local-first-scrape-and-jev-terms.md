# Local-first scrape, hidden terms text, and Jev as the terms judge: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape the 7,500 casinos from the user's Mac through a local Chrome on the HMA VPN, read terms that are hidden in accordions or served as PDFs, and let Jev (TypeSafe AI) pick the footer's terms link and judge whether a page is the general terms; casinos that still fail go through Browserless on GitHub Actions as today.

**Architecture:** `src/scrape.mjs` keeps the job loop, sessions and result rows; the page-reading code (lobby, terms search, document reading) moves to a new `src/terms.mjs` so a probe script and tests can use it. New small modules: `src/doctext.mjs` (hidden text), `src/pdf.mjs` (PDF text), `src/jev.mjs` (every Jev question, threshold and the HTTP call), `src/retry-ids.mjs` (ids for the Browserless fallback). The exit plan (`PROXY_PLAN`) gains a `local` phase type that launches the installed Chrome instead of dialling Browserless.

**Tech Stack:** Node 26 locally (Node 22 on Actions), ESM, `playwright-core` with the installed Google Chrome (`channel: "chrome"`), `pdfjs-dist` (new dependency), Jev over plain `fetch` (`POST https://api.typesafe.ai/v1/systemone`, model `jev-1.14.0`), `node --test` for tests.

**Spec:** `docs/superpowers/specs/2026-10-29-local-first-scrape-and-jev-terms-design.md`

## Global Constraints

- Keys live in a gitignored `.env`: `BROWSERLESS_TOKEN`, `TYPESAFE_API_KEY`, `PROXY_PLAN=local:no`. Local commands run as `node --env-file=.env …`. Never print a key; `scrape.mjs` already masks the Browserless token in errors.
- No Jev key, or a Jev API error, must leave the terms search behaving exactly as before (fail open). Jev adds candidates and acceptances, never removes them.
- Jev model pinned to `jev-1.14.0`. Thresholds: link Noul ≥ 0.7, option probability ≥ 0.2 (at most two picks), page Noul ≥ 0.7. At most 60 link entries per question; page text sent to Jev capped at 6,000 characters.
- Hidden text is used only when it is ≥ 2,000 characters and ≥ 3× the visible text. PDFs over 20 MB are not read. Document text capped at 250,000 characters (as today).
- New result column `jev` appended after `mb`. All other columns unchanged.
- The one new dependency is `pdfjs-dist`. Tests run with `npm test` (`node --test`), no test framework.
- Each task ends with the existing tests green: `npm test`.
- Commit after each task. The three files with uncommitted changes at the start (`src/diagnose.mjs`, `src/jobs.mjs`, `src/scrape.mjs`) are the user's in-progress work on the resolved-landing-URL start and the casino timeout; they are committed as part of Task 1, not reverted.

---

### Task 1: Move the page-reading code into `src/terms.mjs`

A pure move. `scrape.mjs` is 478 lines; the lobby/terms/document functions have no dependency on sessions or jobs, and the probe script (Task 9) and tests need to import them.

**Files:**
- Create: `src/terms.mjs`
- Modify: `src/scrape.mjs` (the reading functions between lines 48 and 324 move out; `TRACKER_HOSTS`, `BLOCK_TEXT`, `wsUrl`, `connect`, `resolveDirect`, `whereAmI`, `BLOCK_PATTERNS`, `installBlocklist` stay; imports change)
- Modify: `package.json` (add `"test": "node --test"`), `.gitignore` (add `.playwright-mcp/`)

**Interfaces:**
- Produces (exports of `src/terms.mjs`): `sleep(ms)`, `host(url)`, `clip(s, n)`, `dbg(...a)`, `CHALLENGE_TEXT`, `bodyText(page)`, `settle(page, httpStatus = 0)`, `readLobby(page)` → `{ url, footer, links, clickables }`, `readDoc(page, budget, want)` → `{ ok, text, note? }`, `readsLikeTerms(text)`, `DOC_WALL`, `expandSections(page)`, `fetchTerms(page, lobby)` → `{ href, text, via, tried, walled? }`.

- [ ] **Step 1: Commit the user's pending changes as they are**

```bash
git add src/diagnose.mjs src/jobs.mjs src/scrape.mjs
git commit -m "Start from the resolved landing URL, bound a casino to 20 minutes, keep hung shards alive

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 2: Create `src/terms.mjs` with the moved code**

Cut these from `src/scrape.mjs` and paste them, in this order, into `src/terms.mjs` under the header below: the `sleep`, `host`, `clip` one-liners (lines 50–52), `CHALLENGE_TEXT` (line 48), `bodyText` and `settle` (lines 95–109), `CLICK_TEXT` and `readLobby` (lines 145–187), the `DOC_WALL` … `readsLikeTerms` block (lines 189–197), `readDoc` (lines 198–218), `expandSections` (lines 220–228), the `dbg` line and `fetchTerms` (lines 230–324, comment included). Prefix each of `sleep`, `host`, `clip`, `dbg`, `CHALLENGE_TEXT`, `bodyText`, `settle`, `readLobby`, `readDoc`, `readsLikeTerms`, `DOC_WALL`, `expandSections`, `fetchTerms` with `export`.

```js
// Reads a casino: the lobby and its footer, the terms search, and documents. No sessions or jobs here: scrape.mjs
// opens the browser, probe-jev.mjs opens a local one, and the tests call the pure parts.
import { termsCandidates, registrable } from "./links.mjs";
```

- [ ] **Step 3: Point `src/scrape.mjs` at the moved code**

Replace the import block at the top with:

```js
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { stringify } from "csv-stringify/sync";
import { extract, licenceNumbers, jurisdictions } from "./extract.mjs";
import { termsCandidates, otherDocs, regionalSites } from "./links.mjs";
import { sleep, host, clip, CHALLENGE_TEXT, settle, readLobby, fetchTerms } from "./terms.mjs";
```

`TRACKER_HOSTS` and `BLOCK_TEXT` stay in `scrape.mjs` (used by `attempt` and `resolveDirect`). Remove the now-unused `registrable` import.

- [ ] **Step 4: Test script and ignore file**

In `package.json` `scripts` add `"test": "node --test"`. Append `.playwright-mcp/` to `.gitignore`.

- [ ] **Step 5: Verify nothing changed**

Run: `npm test` → expected: 9 pass, 0 fail.
Run: `node --check src/scrape.mjs && node --check src/terms.mjs` → no output.
Run: `grep -nE "readLobby|fetchTerms|settle\(|CHALLENGE_TEXT|clip\(|host\(|sleep\(" src/scrape.mjs | head` → every use is covered by the import line.

- [ ] **Step 6: Commit**

```bash
git add src/terms.mjs src/scrape.mjs package.json .gitignore
git commit -m "Move the lobby, terms and document reading into src/terms.mjs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The local phase

**Files:**
- Modify: `src/scrape.mjs` (`PROXY_PLAN`, `CONCURRENCY`, token check, `connect`, `resolveDirect`, the phase tag in `run`, the shard start)
- Modify: `README.md` ("Locally" section)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PROXY_PLAN` phase type `"local"`; `connect(country, "local")` returns a launched Chrome; `exit_country` values `local-<cc>`; `--force` runs `--ids` casinos even when already in the results.

- [ ] **Step 1: Parse the plan before the concurrency default, and allow a token-less local plan**

In `src/scrape.mjs` replace lines 12–23 (from `const SHARD` through the `if (!TOKEN)` throw; `CONCURRENCY` moves below the plan) with:

```js
const SHARD = Number(arg("--shard", 0));
const SHARDS = Number(arg("--shards", 1));
const IDS = arg("--ids", "") ? new Set(arg("--ids").split(",")) : null;
const FORCE = process.argv.includes("--force"); // with --ids: run them even when a previous result exists
const DEADLINE = Number(arg("--deadline-minutes", 0)) > 0 ? Date.now() + Number(arg("--deadline-minutes")) * 60000 : Infinity; // no new casino is started after this
const TOKEN = process.env.BROWSERLESS_TOKEN;
const REGION = process.env.BROWSERLESS_REGION || "production-sfo";
// Exits are tried in phases. "local:no" launches the installed Chrome on this machine (the VPN decides the country;
// the code is only a label for the rows); "datacenter:ca,de" is Browserless's datacenter proxy (2 units per MB, and
// it tunnels to domains the residential one refuses, such as bitstarz.com); "residential:..." its residential proxy
// (6 units per MB) for casinos that block hosting IPs (PlayGrand, Rokubet, BangaWin in the test set).
const PROXY_PLAN = (process.env.PROXY_PLAN || `datacenter:ca,de;residential:${process.env.EXIT_COUNTRIES || "ca,de,nz,fi,ie,br,jp,in"}`)
  .split(";").filter(Boolean).map((ph) => { const [type, list] = ph.split(":"); return { type: type.trim(), countries: list.split(",").map((c) => c.trim()).filter(Boolean) }; });
const LOCAL = PROXY_PLAN.some((p) => p.type === "local");
const LOCAL_HEADLESS = (process.env.LOCAL_HEADLESS || "true") !== "false";
const CONCURRENCY = Number(arg("--concurrency", LOCAL ? 6 : 2));
if (!TOKEN && !PROXY_PLAN.every((p) => p.type === "local")) throw new Error("BROWSERLESS_TOKEN is not set");
```

- [ ] **Step 2: Honour `--force` in the job filter**

Replace the `const jobs = all.filter(...)` line with:

```js
const jobs = all.filter((j, i) => i % SHARDS === SHARD && (!done.has(j.id) || (FORCE && IDS)) && (!IDS || IDS.has(j.id)));
```

- [ ] **Step 3: Launch Chrome for the local phase**

Replace `connect` with:

```js
/**
 * Opens a browser session: the installed Chrome for the local phase, otherwise Browserless. A 429 from Browserless
 * means the plan's concurrent-session limit is full (other shards hold the sessions), so wait and try again rather
 * than fail the row.
 */
async function connect(country, type) {
  if (type === "local") return chromium.launch({ channel: "chrome", headless: LOCAL_HEADLESS, args: ["--disable-blink-features=AutomationControlled"] });
  let delay = 4000;
  for (let i = 0; ; i++) {
    try { return await chromium.connectOverCDP(wsUrl(country, type), { timeout: 45000 }); }
    catch (e) {
      if (!/429|Too Many Requests/.test(e.message) || i >= 8) throw e;
      await sleep(delay + Math.random() * 3000);
      delay = Math.min(delay * 2, 30000);
    }
  }
}
```

In `resolveDirect`, replace `const browser = await connect("direct");` with:

```js
  const browser = LOCAL ? await connect("local", "local") : await connect("direct");
```

- [ ] **Step 4: Tag local rows**

In `run`, replace the `const tag = ...` line with:

```js
    const tag = (c) => `${phase.type === "datacenter" ? "dc-" : phase.type === "local" ? "local-" : ""}${c}`;
```

- [ ] **Step 5: Print where the local browser leaves from**

Just above `let next = 0, n = 0;` add:

```js
// Where a local run leaves from, for the log: the VPN should be on, but the run goes on either way.
if (LOCAL && jobs.length) {
  const b = await connect("local", "local");
  try { const { ip, ip_country } = await whereAmI(await b.newContext()); console.log(`local Chrome leaves from ${ip || "?"} (${ip_country || "unknown"}); the plan says ${PROXY_PLAN.find((p) => p.type === "local").countries.join("/")}`); }
  finally { await b.close().catch(() => {}); }
}
```

- [ ] **Step 6: README**

Replace the "Locally" section of `README.md` with:

````markdown
## Locally (the first pass)

The full set is scraped from a Mac through the installed Google Chrome, with the VPN on. Put the keys in `.env`
(gitignored):

```
PROXY_PLAN=local:no
TYPESAFE_API_KEY=...
BROWSERLESS_TOKEN=...        # only needed for a plan with a Browserless phase, or for src/diagnose.mjs
```

```
npm install
node src/jobs.mjs                                    # out/jobs.json, one job per casino
node --env-file=.env src/scrape.mjs --concurrency 6  # out/results/shard-0.csv; stop and re-run to continue
node src/merge.mjs                                   # out/results.csv, out/results-by-row.csv
```

`PROXY_PLAN=local:no` tries every casino through the local Chrome once (the country code is a label for the rows;
the VPN decides the real exit, which the log prints at start). `LOCAL_HEADLESS=false` shows the browser windows.
`--ids id1,id2 --force` re-runs casinos that already have a result.
````

- [ ] **Step 7: Verify with one casino that worked before**

Pick an id that had terms in the last run:

```bash
node -e 'const {parse}=require("csv-parse/sync");const r=parse(require("fs").readFileSync("out/full1/results.csv"),{columns:true}).find(x=>x.terms_found==="yes"&&x.exit_country==="dc-ca");console.log(r.id,r.final_domain)'
```

Run (VPN on): `node src/jobs.mjs && node --env-file=.env src/scrape.mjs --ids <that id> --force --concurrency 1`
Expected: the log line `local Chrome leaves from <ip> (NO)…`, then `[1/1] <id> … -> ok <domain> local-no <n>s`, and the new row in `out/results/shard-0.csv` has `terms_found,yes` and `exit_country,local-no`.

Run: `npm test` → 9 pass.

- [ ] **Step 8: Commit**

```bash
git add src/scrape.mjs README.md
git commit -m "Local phase: scrape through the installed Chrome on the VPN before any proxy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Hidden text (accordion terms)

**Files:**
- Create: `src/doctext.mjs`, `tests/doctext.test.mjs`
- Modify: `src/terms.mjs` (`readDoc`, `fetchTerms`'s `tryLink` return), `src/scrape.mjs` (document label)

**Interfaces:**
- Produces: `hiddenTextInPage()` (runs inside the page via `page.evaluate`), `preferHidden(visible, hidden)` → boolean, `MIN_HIDDEN = 2000`. `readDoc` results gain `hidden: true` when the hidden text was used; `fetchTerms` results carry `hidden`.

- [ ] **Step 1: Write the failing tests**

`tests/doctext.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { hiddenTextInPage, preferHidden } from "../src/doctext.mjs";

test("preferHidden: only a hidden text that is long and much longer than the visible one", () => {
  assert.equal(preferHidden("x".repeat(1000), "y".repeat(3000)), true);
  assert.equal(preferHidden("x".repeat(1000), "y".repeat(2500)), false); // not 3x
  assert.equal(preferHidden("x".repeat(100), "y".repeat(1500)), false); // under 2,000
});

// SoftSwiss "/rules": section headings visible, the sections themselves display:none until clicked.
const clause = (n) => `<p><span>${n}.1</span> Please read these General Terms and Conditions prior to using our website. ${"These Terms govern every bet placed and every withdrawal requested. ".repeat(15)}</p>`;
const FIXTURE = `<!doctype html><html><head><style>.panel{display:none}</style></head><body>
<header><nav><a href="/">Lobby</a><a href="/promo">Promotions</a></nav></header>
<article class="info-article"><h1>General Terms and Conditions</h1><p>Version 1.8</p>
${[1, 2, 3, 4, 5].map((n) => `<div><h2>Section ${n}</h2><div class="panel">${clause(n)}</div></div>`).join("")}
</article>
<footer><a href="/privacy">Privacy</a><a href="/rules">Terms and Conditions</a><script>var x = "script text must not leak";</script></footer>
</body></html>`;

test("hiddenTextInPage returns the collapsed sections, without nav, footer or scripts", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    const visible = await page.evaluate(() => document.body.innerText);
    const hidden = await page.evaluate(hiddenTextInPage);
    assert.ok(visible.length < 300, `visible text is only the headings: ${visible.length}`);
    assert.ok(hidden.length > 4000, `hidden text holds the sections: ${hidden.length}`);
    assert.match(hidden, /3\.1 Please read these General Terms/);
    assert.doesNotMatch(hidden, /script text must not leak|Promotions|Privacy/);
    assert.match(hidden, /Section 2\n/); // block elements end a line
    assert.equal(preferHidden(visible, hidden), true);
  } finally { await browser.close(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/doctext.test.mjs` → expected: fails with `Cannot find module '../src/doctext.mjs'`.

- [ ] **Step 3: Write `src/doctext.mjs`**

```js
// Text a page holds but does not show. Single-page casinos lay their terms out as an accordion (SoftSwiss "/rules"):
// innerText is the section headings, while the sections sit in the DOM hidden by CSS. textContent reads them.
export const MIN_HIDDEN = 2000;

/** Runs inside the page (page.evaluate): body textContent minus scripts, styles and the page chrome, one block per line. */
export function hiddenTextInPage() {
  const root = document.body.cloneNode(true);
  for (const el of root.querySelectorAll("script, style, noscript, template, svg, header, nav, footer")) el.remove();
  const BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|TR|TD|TH|SECTION|ARTICLE|BR|TABLE|DD|DT|DL|BLOCKQUOTE|PRE|DETAILS|SUMMARY)$/;
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) { out.push(n.nodeValue); return; }
    if (n.nodeType !== 1) return;
    const block = BLOCK.test(n.tagName);
    if (block) out.push("\n");
    for (const c of n.childNodes) walk(c);
    if (block) out.push("\n");
  };
  walk(root);
  return out.join("").replace(/[ \t \r]+/g, " ").replace(/ *\n[ \n]*/g, "\n").trim();
}

/** The hidden text replaces the visible one only when it is a document in its own right, not a few more labels. */
export function preferHidden(visible, hidden) {
  return hidden.length >= MIN_HIDDEN && hidden.length >= 3 * visible.length;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/doctext.test.mjs` → expected: 2 pass.

- [ ] **Step 5: Use it in `readDoc`**

In `src/terms.mjs` add the import `import { hiddenTextInPage, preferHidden } from "./doctext.mjs";` and replace `readDoc` with:

```js
// `want` says what a finished document looks like; until the text satisfies it the wait goes on, since a shell
// with only the navigation is stable long before the document itself arrives (NetBet's help pages). Text that has
// stopped changing and still does not satisfy it may be in the page but collapsed (SoftSwiss accordions): then the
// hidden text is read, and used when it is the document.
export async function readDoc(page, budget = 25000, want = (t) => t.length >= 500) {
  const t0 = Date.now();
  let lastLen = -1, seenLen = -1, wallSince = 0;
  const hidden = async (t) => {
    const h = await page.evaluate(hiddenTextInPage).catch(() => "");
    return preferHidden(t, h) && !placeholder(h) && want(h) ? h : "";
  };
  while (Date.now() - t0 < budget) {
    const t = await bodyText(page);
    const head = t.slice(0, 1500);
    // A bot wall that has not cleared in 12 s will not: give up early, the caller moves on.
    if (DOC_WALL.test(head)) { wallSince ||= Date.now(); if (Date.now() - wallSince > 12000) return { ok: false, text: t, note: "wall" }; } else wallSince = 0;
    const settled = t.length === seenLen;
    seenLen = t.length;
    if (t.length >= 500 && !DOC_WALL.test(head) && !DOC_LOADING.test(t.slice(0, 400)) && !placeholder(t) && want(t)) {
      if (t.length === lastLen) return { ok: true, text: t };
      lastLen = t.length;
    } else if (settled && !DOC_WALL.test(head)) {
      const h = await hidden(t);
      if (h) return { ok: true, text: h, hidden: true };
    }
    await sleep(1500);
  }
  const t = await bodyText(page);
  const wall = DOC_WALL.test(t.slice(0, 1500));
  if (!wall) { const h = await hidden(t); if (h) return { ok: true, text: h, hidden: true }; }
  return { ok: t.length >= 500 && !wall && !placeholder(t), text: t, note: wall ? "wall" : t.length < 500 ? "thin" : placeholder(t) ? "placeholder" : "still loading" };
}
```

- [ ] **Step 6: Carry the flag to the result**

In `fetchTerms`'s `tryLink`, change `if (good) return { href: page.url(), text: d.text, via: "link", tried };` to `if (good) return { href: page.url(), text: d.text, via: "link", hidden: !!d.hidden, tried };`. In the click branch change `return { href: navigated ? ... , text: d.text, via: "click", tried };` to include `hidden: !!d.hidden,` likewise, and in the guess branch `return { href: page.url(), text: d.text, via: "guess", hidden: !!d.hidden, tried };`.

In `src/scrape.mjs` `attempt`, replace the terms label line with:

```js
    if (terms.text) docs.push({ label: `terms ${terms.href}${terms.via !== "link" ? ` (via ${terms.via})` : ""}${terms.hidden ? " (hidden text)" : ""}`, text: terms.text.slice(0, 250000) });
```

- [ ] **Step 7: Verify on a live accordion casino**

Run (VPN on): `DEBUG=1 node --env-file=.env src/scrape.mjs --ids askgamblers-00019 --force --concurrency 1`
Expected: `[debug] link https://crusado-e.com/ca/rules ok <n> chars` with n above 100,000, the row `terms_found,yes`, and `pages` containing `terms https://crusado-e.com/ca/rules (hidden text)`. `out/text/askgamblers-00019.txt` holds the clauses ("1.1 Please read these General Terms").

Run: `npm test` → 11 pass.

- [ ] **Step 8: Commit**

```bash
git add src/doctext.mjs tests/doctext.test.mjs src/terms.mjs src/scrape.mjs
git commit -m "Read terms hidden in collapsed sections: SoftSwiss /rules pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: PDF terms and off-domain footer links

**Files:**
- Create: `src/pdf.mjs`, `tests/pdf.test.mjs`
- Modify: `src/links.mjs` (`termsScore`), `tests/links.test.mjs`, `src/terms.mjs` (`tryLink`), `src/scrape.mjs` (label), `package.json` (dependency)

**Interfaces:**
- Produces: `isPdf(href)` (from `links.mjs`), `pdfText(bytes, maxChars = 250000)` → string (from `pdf.mjs`). `fetchTerms` results carry `pdf: true`.

- [ ] **Step 1: Failing link tests**

Append to `tests/links.test.mjs`:

```js
test("betico: a footer Terms link to a PDF on a file host qualifies; a regulator's /terms and a non-footer CDN link do not", () => {
  const pdf = "https://d2xmnpb6h303sl.cloudfront.net/static/navigation/terms_and_conditions.pdf";
  const links = [L("Terms of Service", pdf, true), L("Terms", "https://www.gamblingauthority.cw/terms", true), L("Terms of Service", "https://d2xmnpb6h303sl.cloudfront.net/other/terms.html")];
  assert.deepEqual(termsCandidates(links, "https://betico.pro/").map((l) => l.href), [pdf]);
});

test("an own-domain terms page still outranks an off-domain PDF", () => {
  const links = [L("Terms", "https://cdn.example-casino.com/docs/terms.pdf", true), L("Terms and Conditions", "https://www.example-casino.com/terms", true)];
  assert.equal(termsCandidates(links, "https://www.example-casino.com/")[0].href, "https://www.example-casino.com/terms");
});

test("isPdf", () => {
  assert.equal(isPdf("https://x.com/a/terms.pdf"), true);
  assert.equal(isPdf("https://x.com/a/terms.pdf?v=3"), true);
  assert.equal(isPdf("https://x.com/pdf/terms"), false);
});
```

Change the test file's import to `import { termsCandidates, otherDocs, regionalSites, isPdf } from "../src/links.mjs";`.

Run: `node --test tests/links.test.mjs` → expected: the three new tests fail (`isPdf` is not exported; betico list is empty).

- [ ] **Step 2: Allow file-host footer links in `termsScore`**

In `src/links.mjs` add after `KYC`:

```js
// Hosts casinos park their legal PDFs on (betico.pro's terms live on CloudFront). Other domains are never the terms:
// a regulator's or a game provider's /terms must not win.
const FILE_HOST = /(^|\.)(cloudfront\.net|amazonaws\.com|storage\.googleapis\.com|blob\.core\.windows\.net)$|^(cdn|static|files|assets|docs)\./i;
export const isPdf = (u) => /\.pdf(\?|#|$)/i.test(u);
```

Replace the start of `termsScore` (up to and including the `if (!inPath && !inText) return null;` line) with:

```js
export function termsScore(l, pageUrl) {
  if (!/^https?:/i.test(l.href) || isHome(l.href)) return null;
  const text = (l.text || "").trim(), p = path(l.href), both = text + " " + p;
  const inPath = TERMS_PATH.test(p), inText = TERMS_TEXT.test(text);
  const own = host(l.href).endsWith(registrable(host(pageUrl)));
  if (!own && !(l.footer && inText && (isPdf(l.href) || FILE_HOST.test(host(l.href))))) return null;
  if (!inPath && !inText) return null;
```

and after the `if (l.footer) s += 2;` line add `if (!own) s -= 3; // a PDF on a file host is the terms only when nothing on the casino's own domain is`.

Run: `node --test tests/links.test.mjs` → 12 pass.

- [ ] **Step 3: Failing PDF test**

`npm install pdfjs-dist` (adds it to `dependencies`).

`tests/pdf.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfText } from "../src/pdf.mjs";

// A one-page PDF with a correct cross-reference table, built here so the test needs no fixture file.
function tinyPdf(lines) {
  const stream = `BT /F1 12 Tf 20 120 Td 14 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 160] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("pdfText reads the lines of a PDF in order", async () => {
  const text = await pdfText(tinyPdf(["General Terms and Conditions", "1.1 These terms apply to every player.", "1.2 Withdrawals are processed within 24 hours."]));
  assert.match(text, /General Terms and Conditions\s+1\.1 These terms apply to every player\.\s+1\.2 Withdrawals/);
});

test("pdfText caps the text", async () => {
  const text = await pdfText(tinyPdf(["x".repeat(200)]), 50);
  assert.equal(text.length, 50);
});

test("pdfText rejects what is not a PDF", async () => {
  await assert.rejects(pdfText(Buffer.from("<html>not a pdf</html>")));
});
```

Run: `node --test tests/pdf.test.mjs` → expected: fails, module not found.

- [ ] **Step 4: Write `src/pdf.mjs`**

```js
// Text of a PDF, for terms casinos serve as a file (betico.pro, dexsport, americanluck): the browser's PDF viewer
// exposes no page text, so the bytes are fetched and read here with pdf.js.
export async function pdfText(bytes, maxChars = 250000) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const lines = [];
    let n = 0;
    for (let i = 1; i <= doc.numPages && n < maxChars; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      let line = "", lastY = null;
      for (const it of content.items) {
        if (!("str" in it)) continue;
        const y = Math.round(it.transform[5]);
        if (lastY !== null && y !== lastY) { lines.push(line); line = ""; }
        line += (line && !line.endsWith(" ") ? " " : "") + it.str;
        if (it.hasEOL) { lines.push(line); line = ""; lastY = null; continue; }
        lastY = y;
        n += it.str.length;
      }
      lines.push(line, "");
    }
    return lines.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
  } finally { await doc.destroy(); }
}
```

Run: `node --test tests/pdf.test.mjs` → 3 pass. If pdf.js logs a warning about a missing worker, that is expected in Node and harmless.

- [ ] **Step 5: Read PDF candidates in `fetchTerms`**

In `src/terms.mjs` add imports `import { termsCandidates, registrable, isPdf } from "./links.mjs";` and `import { pdfText } from "./pdf.mjs";`. Inside `fetchTerms`, replace the `tryLink` definition with:

```js
  // A PDF is fetched as bytes and read in Node. page.request shares the session's cookies but not its proxy: it
  // leaves from this process (the VPN locally, the Actions runner on Browserless), which the file hosts allow.
  const tryPdf = async (c, lenient) => {
    try {
      const r = await page.request.get(c.href, { timeout: 30000 });
      if (!r.ok()) throw new Error(`http ${r.status()}`);
      const body = await r.body();
      if (body.length > 20 * 1048576) throw new Error("over 20 MB");
      const text = await pdfText(body);
      const good = text.length >= 500 && (lenient || readsLikeTerms(text));
      dbg("pdf", c.href, good ? `ok ${text.length} chars` : `${text.length} chars, not terms-like`);
      if (good) return { href: c.href, text, via: "link", pdf: true, tried };
      tried.push(`${c.href} (${text.length < 500 ? "pdf thin" : "pdf not terms-like"})`);
    } catch (e) { tried.push(`${c.href} (pdf unreadable: ${clip(e.message, 50)})`); }
    return null;
  };
  const tryLink = async (c, lenient = false) => {
    if (isPdf(c.href)) return tryPdf(c, lenient);
    let resp;
    try { resp = await page.goto(c.href, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch (e) { tried.push(`${c.href} (${clip(e.message, 60)})`); return null; }
    if (/application\/pdf/i.test((resp && resp.headers()["content-type"]) || "")) return tryPdf({ ...c, href: page.url() }, lenient);
    let d = await readDoc(page, 35000, lenient ? undefined : readsLikeTerms); // BangaWin bounces through an auth callback for ~20 s before the text arrives
    // A terms page laid out as an accordion shows only its section titles (SoftSwiss "/rules" pages): open every
    // collapsed section and read again.
    if (!d.ok || !readsLikeTerms(d.text)) { if (await expandSections(page)) d = await readDoc(page, 10000, lenient ? undefined : readsLikeTerms); }
    const good = d.ok && (lenient || readsLikeTerms(d.text));
    dbg("link", c.href, good ? `ok ${d.text.length} chars` : d.ok ? "not terms-like" : d.note);
    if (good) return { href: page.url(), text: d.text, via: "link", hidden: !!d.hidden, tried };
    tried.push(`${c.href} (${d.ok ? "not terms-like" : d.note})`);
    return null;
  };
```

The sitemap/guess loop in `fetchTerms` navigates with `page.goto` directly; leave it, since guessed paths are never PDFs.

In `src/scrape.mjs` `attempt`, extend the label: `${terms.hidden ? " (hidden text)" : ""}${terms.pdf ? " (pdf)" : ""}`.

- [ ] **Step 6: Verify on betico**

Run (VPN on): `DEBUG=1 node --env-file=.env src/scrape.mjs --ids askgamblers-00359 --force --concurrency 1`
Expected: `[debug] pdf https://d2xmnpb6h303sl.cloudfront.net/static/navigation/terms_and_conditions.pdf ok <n> chars`, row `terms_found,yes`, `pages` holds `(pdf)`.

Run: `npm test` → 17 pass.

- [ ] **Step 7: Commit**

```bash
git add src/pdf.mjs tests/pdf.test.mjs src/links.mjs tests/links.test.mjs src/terms.mjs src/scrape.mjs package.json package-lock.json
git commit -m "Read terms served as PDFs, and footer terms links hosted on a CDN

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The Jev module

Every question, option name, threshold and the HTTP call, in one file, with no network in the tests.

**Files:**
- Create: `src/jev.mjs`, `tests/jev.test.mjs`

**Interfaces:**
- Produces:
  - `askJev(state, questions, { timeoutMs = 20000, fetchFn = fetch } = {})` → `answers` object, or `null` when `TYPESAFE_API_KEY` is unset; throws on any HTTP failure other than one retried 429.
  - `linkEntries(lobby)` → `[{ id, text, href, in_footer, kind: "link" | "text" }]` (full hrefs; at most 60; footer first).
  - `termsLinkQuestions(entries)` → `{ state, questions }` for the footer choice (`has_terms` Noul, `terms_link` Choice).
  - `jevPicks(answers, entries)` → up to two entries, best first, `[]` unless the Noul ≥ 0.7; each with `p`.
  - `linkSummary(answers)` → `"link:0.93/0.81"` or `"off"`.
  - `termsPageQuestion({ title, headings, text })` → `{ state, questions }` (`is_terms` Noul).
  - `acceptsPage(answers)` → boolean; `pageSummary(answers)` → `"page:0.12"` or `"off"`.

- [ ] **Step 1: Failing tests**

`tests/jev.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { askJev, linkEntries, termsLinkQuestions, jevPicks, linkSummary, termsPageQuestion, acceptsPage, pageSummary, MAX_ENTRIES } from "../src/jev.mjs";

const L = (text, href, footer = false) => ({ text, href, footer });
const betico = {
  url: "https://betico.pro/",
  links: [L("Slots", "https://betico.pro/casino/slots"), L("Sports Betting Rules", "https://d2xmnpb6h303sl.cloudfront.net/static/terms/sports-betting.pdf", true),
    L("Terms of Service", "https://d2xmnpb6h303sl.cloudfront.net/static/navigation/terms_and_conditions.pdf", true), L("Privacy", "https://betico.pro/privacy", true),
    L("", "https://verification.anjouangamingboard.org/validate?x=1", true), L("Promotions", "https://betico.pro/promotion", true), L("Terms of Service", "https://d2xmnpb6h303sl.cloudfront.net/static/navigation/terms_and_conditions.pdf", true)],
  clickables: [{ text: "T&Cs apply", footer: false }, { text: "Conditions:", footer: true }],
};

test("linkEntries: footer links first, de-duplicated, descriptive ids, clickables as text entries, logo links without text dropped", () => {
  const e = linkEntries(betico);
  // legal-looking footer links, then the clickable texts, then the rest of the footer
  assert.deepEqual(e.map((x) => x.text), ["Sports Betting Rules", "Terms of Service", "Privacy", "T&Cs apply", "Conditions:", "Promotions"]);
  assert.match(e[1].id, /^terms_of_service_\d+$/);
  assert.equal(e[1].href, "https://d2xmnpb6h303sl.cloudfront.net/static/navigation/terms_and_conditions.pdf");
  assert.equal(e[1].in_footer, true);
  assert.deepEqual(e.slice(3, 5).map((x) => x.kind), ["text", "text"]);
  assert.equal(new Set(e.map((x) => x.id)).size, e.length);
});

test("linkEntries: a non-footer link joins only when it looks legal, and the list is capped", () => {
  const links = Array.from({ length: 80 }, (_, i) => L(`Game ${i}`, `https://x.com/g/${i}`, true));
  links.push(L("User Agreement", "https://x.com/legal/user-agreement"), L("Blackjack", "https://x.com/blackjack"));
  const e = linkEntries({ url: "https://x.com/", links, clickables: [] });
  assert.equal(e.length, MAX_ENTRIES);
  assert.ok(e.some((x) => x.text === "User Agreement"), "the legal-looking link is kept ahead of the cap");
  assert.ok(!e.some((x) => x.text === "Blackjack"));
});

test("termsLinkQuestions: the Choice's options are the entry ids and the state carries no kind", () => {
  const e = linkEntries(betico);
  const q = termsLinkQuestions(e);
  assert.deepEqual(Object.keys(q.questions.terms_link.criteria), e.map((x) => x.id));
  assert.equal(q.questions.has_terms.type, "noul");
  assert.deepEqual(Object.keys(q.state.links[0]), ["id", "text", "href", "in_footer"]);
  assert.match(q.questions.terms_link.criteria[e[1].id], /Terms of Service.*terms_and_conditions\.pdf.*footer/);
});

test("jevPicks: confident answers give up to two picks, best first; a low Noul or no answer gives none", () => {
  const e = linkEntries(betico);
  const [rules, terms, privacy] = e;
  const probs = { [rules.id]: 0.25, [terms.id]: 0.7, [privacy.id]: 0.05 };
  const picks = jevPicks({ has_terms: { noul: 0.9 }, terms_link: { choice: terms.id, confidence: 0.6, probabilities: probs } }, e);
  assert.deepEqual(picks.map((p) => p.text), ["Terms of Service", "Sports Betting Rules"]);
  assert.equal(picks[0].p, 0.7);
  assert.deepEqual(jevPicks({ has_terms: { noul: 0.4 }, terms_link: { probabilities: probs } }, e), []);
  assert.deepEqual(jevPicks(null, e), []);
  assert.deepEqual(jevPicks({ has_terms: { noul: 0.9 }, terms_link: { probabilities: { nope: 1 } } }, e), []);
});

test("summaries", () => {
  assert.equal(linkSummary({ has_terms: { noul: 0.934 }, terms_link: { probabilities: { a: 0.81, b: 0.19 } } }), "link:0.93/0.81");
  assert.equal(linkSummary(null), "off");
  assert.equal(pageSummary({ is_terms: { noul: 0.123 } }), "page:0.12");
});

test("termsPageQuestion caps the text and headings; acceptsPage applies the threshold", () => {
  const q = termsPageQuestion({ title: "Rules", headings: Array.from({ length: 40 }, (_, i) => `H${i}`), text: "t".repeat(9000) });
  assert.equal(q.state.page.text.length, 6000);
  assert.equal(q.state.page.headings.length, 30);
  assert.equal(q.questions.is_terms.type, "noul");
  assert.equal(acceptsPage({ is_terms: { noul: 0.7 } }), true);
  assert.equal(acceptsPage({ is_terms: { noul: 0.69 } }), false);
  assert.equal(acceptsPage(null), false);
});

test("askJev: null without a key; retries one 429; returns the answers; throws on other errors", async () => {
  delete process.env.TYPESAFE_API_KEY;
  assert.equal(await askJev({}, {}), null);
  process.env.TYPESAFE_API_KEY = "test-key";
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return { status: 429, ok: false, headers: new Headers({ "retry-after": "0" }), text: async () => "slow down" };
    return { status: 200, ok: true, headers: new Headers(), json: async () => ({ model: "jev-1.14.0", answers: { x: { type: "noul", noul: 0.5 } } }) };
  };
  const answers = await askJev({ a: 1 }, { x: { type: "noul", instructions: "?" } }, { fetchFn });
  assert.deepEqual(answers, { x: { type: "noul", noul: 0.5 } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.authorization, "Bearer test-key");
  assert.equal(JSON.parse(calls[1].init.body).model, "jev-1.14.0");
  await assert.rejects(askJev({}, {}, { fetchFn: async () => ({ status: 500, ok: false, headers: new Headers(), text: async () => "boom" }) }), /jev http 500/);
  delete process.env.TYPESAFE_API_KEY;
});
```

Run: `node --test tests/jev.test.mjs` → expected: fails, module not found.

- [ ] **Step 2: Write `src/jev.mjs`**

```js
// Everything the scraper asks Jev (TypeSafe AI): the two judgments, their wording, how the answers are read, and
// the HTTP call. Jev supplies judgments; the code in terms.mjs decides what to do with them, and runs unchanged
// when there is no key or the call fails.
const API = "https://api.typesafe.ai/v1/systemone";
export const MODEL = "jev-1.14.0"; // pinned: aliases move when a new release ships
export const LINK_NOUL_MIN = 0.7; // "the lobby has a terms link" must be at least this likely before a pick is used
export const LINK_PICK_MIN = 0.2; // an option is tried when at least this likely (at most two)
export const PAGE_NOUL_MIN = 0.7; // "this page is the general terms"
export const MAX_ENTRIES = 60;
const PAGE_TEXT_CHARS = 6000;

const key = () => process.env.TYPESAFE_API_KEY || "";
const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
const path = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
const LEGAL = /terms|conditions|\btos\b|legal|agreement|rules|policy|privacy|regulamin|\bagb\b|bedingungen|condi|termos/i;

/** One request. null without a key; the answers object otherwise; throws on failure after one retried 429. */
export async function askJev(state, questions, { timeoutMs = 20000, fetchFn = fetch } = {}) {
  if (!key()) return null;
  for (let i = 0; ; i++) {
    const res = await fetchFn(API, { method: "POST", headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions }), signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 429 && i < 1) {
      const ra = res.headers.get("retry-after");
      await new Promise((r) => setTimeout(r, (ra === null || Number.isNaN(Number(ra)) ? 5 : Math.min(30, Number(ra))) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`jev http ${res.status}: ${clip(await res.text(), 200)}`);
    return (await res.json()).answers;
  }
}

/**
 * The lobby as Jev sees it: legal-looking footer links, then the clickable texts, then legal-looking links elsewhere,
 * then the rest of the footer; one entry per href; at most MAX_ENTRIES, so a footer of game links cannot push the
 * terms out. A link with no text and no legal-looking path (a payment logo, a licence seal) is left out. Option names
 * are sent to the model, so each id starts with the link's own words.
 */
export function linkEntries(lobby) {
  const seen = new Set(), out = [];
  const legal = (l) => LEGAL.test(l.text + " " + path(l.href));
  const add = (text, href, footer, kind) => {
    const k = href || `text:${text}`;
    if (seen.has(k) || out.length >= MAX_ENTRIES) return;
    if (!text && !LEGAL.test(path(href))) return;
    seen.add(k);
    out.push({ id: `${slug(text) || slug(path(href)) || "link"}_${out.length}`, text: clip(text, 60), href: href || "", in_footer: !!footer, kind });
  };
  for (const l of lobby.links) if (l.footer && legal(l)) add(l.text, l.href, true, "link");
  for (const c of lobby.clickables) add(c.text, "", c.footer, "text");
  for (const l of lobby.links) if (!l.footer && legal(l)) add(l.text, l.href, false, "link");
  for (const l of lobby.links) if (l.footer && !legal(l)) add(l.text, l.href, true, "link");
  return out;
}

/** The footer judgment: is there a general-terms link, and which entry is it. */
export function termsLinkQuestions(entries) {
  const describe = (e) => `${e.kind === "text" ? "clickable text" : "link"} "${e.text}"${e.href ? ` to ${clip(path(e.href), 100)}` : ""}${e.in_footer ? ", in the footer" : ""}`;
  return {
    state: { links: entries.map(({ id, text, href, in_footer }) => ({ id, text, href: clip(href, 160), in_footer })) },
    questions: {
      has_terms: {
        type: "noul",
        instructions: "Does `links` contain a link to the casino's own general terms and conditions?",
        criteria: {
          true: "an entry whose text or URL means the general terms and conditions, terms of service, terms of use or user agreement of the casino itself",
          false: "only privacy, cookie, responsible-gambling, bonus or promotion terms, sports or game rules, 'T&Cs apply' captions, or no legal links at all",
        },
      },
      terms_link: {
        type: "choice",
        instructions: "Which entry in `links` is the link to the casino's own general terms and conditions?",
        criteria: Object.fromEntries(entries.map((e) => [e.id, describe(e)])),
      },
    },
  };
}

/** Jev's picks worth trying, best first: none unless Jev also thinks a terms link exists. */
export function jevPicks(answers, entries) {
  if (!answers || !answers.has_terms || !answers.terms_link || answers.has_terms.noul < LINK_NOUL_MIN) return [];
  return Object.entries(answers.terms_link.probabilities || {}).filter(([, p]) => p >= LINK_PICK_MIN).sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([id, p]) => ({ ...entries.find((e) => e.id === id), p })).filter((e) => e.id);
}

export const linkSummary = (answers) => answers ? `link:${answers.has_terms.noul.toFixed(2)}/${Math.max(0, ...Object.values(answers.terms_link.probabilities || {})).toFixed(2)}` : "off";

/** The page judgment: is this document the general terms. The opening of the page and its headings are enough. */
export function termsPageQuestion({ title, headings, text }) {
  return {
    state: { page: { title: clip(title, 120), headings: (headings || []).slice(0, 30).map((h) => clip(h, 80)), text: (text || "").slice(0, PAGE_TEXT_CHARS) } },
    questions: {
      is_terms: {
        type: "noul",
        instructions: "Is `page` the general terms and conditions of an online casino or sportsbook?",
        criteria: {
          true: "the general terms and conditions, terms of service, terms of use or user agreement that govern a player's account, deposits, bets and withdrawals, shown in full or as its opening sections",
          false: "a promotion's or bonus terms, a privacy or cookie policy, game or sports-betting rules, a help centre, a lobby, a registration form, or an error page",
        },
      },
    },
  };
}

export const acceptsPage = (answers) => !!answers && !!answers.is_terms && answers.is_terms.noul >= PAGE_NOUL_MIN;
export const pageSummary = (answers) => answers ? `page:${answers.is_terms.noul.toFixed(2)}` : "off";
```

- [ ] **Step 3: Run the tests**

Run: `node --test tests/jev.test.mjs` → 7 pass. Run: `npm test` → 24 pass.

- [ ] **Step 4: Commit**

```bash
git add src/jev.mjs tests/jev.test.mjs
git commit -m "Jev module: the footer-link and terms-page questions, thresholds and the API call

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Wire Jev into the terms search

**Files:**
- Modify: `src/terms.mjs` (`fetchTerms`), `src/scrape.mjs` (`COLUMNS`, `attempt`, `run`), `src/merge.mjs` (column union)

**Interfaces:**
- Consumes: everything exported by `src/jev.mjs`.
- Produces: `fetchTerms(page, lobby, jev = { notes: [] })`; the `jev.notes` array collects `link:…`, `page:…`, `off`, `error:…`; result rows gain the `jev` column (notes joined by a space). `via: "jev"` on terms reached through Jev's pick.

- [ ] **Step 1: Ask Jev about the footer, and put its picks first**

In `src/terms.mjs` add `import { askJev, linkEntries, termsLinkQuestions, jevPicks, linkSummary, termsPageQuestion, acceptsPage, pageSummary } from "./jev.mjs";`.

Change the signature and opening of `fetchTerms` from

```js
export async function fetchTerms(page, lobby) {
  const tried = [];
  const cands = termsCandidates(lobby.links, lobby.url);
```

to

```js
export async function fetchTerms(page, lobby, jev = { notes: [] }) {
  const tried = [];
  let cands = termsCandidates(lobby.links, lobby.url);
  // Jev reads the footer once: its picks (when it is confident a terms link exists) go ahead of the scored anchors.
  // The page read validates every candidate, so a wrong pick costs one page load; no key or an error changes nothing.
  const entries = linkEntries(lobby);
  let picks = [];
  if (entries.length) {
    try {
      const q = termsLinkQuestions(entries);
      const answers = await askJev(q.state, q.questions);
      picks = jevPicks(answers, entries);
      jev.notes.push(linkSummary(answers));
    } catch (e) { jev.notes.push(`error:${clip(e.message, 60)}`); }
  }
  const jevLinks = picks.filter((p) => p.kind === "link").map((p) => ({ href: p.href, text: p.text, footer: p.in_footer, score: 99, jev: true }));
  cands = [...jevLinks, ...cands.filter((c) => !jevLinks.some((j) => j.href === c.href))];
  const jevTexts = picks.filter((p) => p.kind === "text").map((p) => p.text);
  lobby = { ...lobby, clickables: [...lobby.clickables.filter((c) => jevTexts.includes(c.text)), ...lobby.clickables.filter((c) => !jevTexts.includes(c.text))] };
  dbg("jev", jev.notes[jev.notes.length - 1] || "off", "picks:", picks.map((p) => `${p.p.toFixed(2)} ${p.kind} "${p.text}" ${p.href}`).join(" | "));
  // Pages Jev has judged in this search, by URL: a candidate is judged once.
  const judged = new Map();
  const isTermsPage = async (text, meta) => {
    if (readsLikeTerms(text)) return true; // the pattern is the fast accept; Jev reads what it rejects
    if (text.length < 1500 || DOC_WALL.test(text.slice(0, 1500))) return false;
    if (!judged.has(meta.url)) judged.set(meta.url, (async () => {
      try {
        const q = termsPageQuestion({ ...meta, text });
        const answers = await askJev(q.state, q.questions);
        jev.notes.push(pageSummary(answers));
        dbg("jev page", meta.url, pageSummary(answers));
        return acceptsPage(answers);
      } catch (e) { jev.notes.push(`error:${clip(e.message, 60)}`); return false; }
    })());
    return judged.get(meta.url);
  };
  const pageMeta = () => page.evaluate(() => ({ url: location.href, title: document.title, headings: [...document.querySelectorAll("h1, h2, h3")].map((h) => h.innerText.trim()).filter(Boolean) })).catch(() => ({ url: page.url(), title: "", headings: [] }));
```

- [ ] **Step 2: Judge pages with Jev where the pattern rejected them**

Still in `fetchTerms`:

In `tryPdf`, replace `const good = text.length >= 500 && (lenient || readsLikeTerms(text));` with `const good = text.length >= 500 && (lenient || await isTermsPage(text, { url: c.href, title: "", headings: [] }));`.

In `tryLink`, replace `const good = d.ok && (lenient || readsLikeTerms(d.text));` with `const good = d.ok && (lenient || await isTermsPage(d.text, await pageMeta()));` and `return { href: page.url(), text: d.text, via: "link", hidden: !!d.hidden, tried };` with `return { href: page.url(), text: d.text, via: c.jev ? "jev" : "link", hidden: !!d.hidden, tried };`.

In the click branch, replace `if ((navigated ? d.ok : grew) && readsLikeTerms(d.text)) return {` with `if ((navigated ? d.ok : grew) && await isTermsPage(d.text, await pageMeta())) return {`.

In the guess loop, replace the `looksLikeTerms` line with:

```js
    const looksLikeTerms = d.ok && d.text.length > lobbyText.length * 0.5 + 1500 && d.text.slice(0, 300) !== lobbyText.slice(0, 300) && (await isTermsPage(d.text, await pageMeta()));
```

Leave the two `readDoc(page, …, readsLikeTerms)` waits as they are: `readDoc` waits for the pattern (or the hidden text) up to its budget, and Jev reads the final text once.

One risk to watch in Task 10's regression sample: `readDoc` now returns hidden text as soon as the visible text has settled, so a single-page app whose shell holds a long hidden menu that mentions terms five times could be accepted before its document arrives. The `preferHidden` ratio and `readsLikeTerms` make that unlikely; a regression there shows up as a `terms` document in `out/text/<id>.txt` that is navigation, not clauses.

- [ ] **Step 3: The `jev` column**

In `src/scrape.mjs`: append `"jev"` to `COLUMNS` after `"mb"`. In `attempt`, replace `const terms = await fetchTerms(page, lobby);` with

```js
    const jev = { notes: [] };
    const terms = await fetchTerms(page, lobby, jev);
```

and add `jev: jev.notes.join(" ")` to the returned object (`return { ...base, finalUrl: base.finalUrl, footer: lobby.footer, docs, termsTried: terms.tried, walled: !!terms.walled, mb: meter.bytes / 1048576, jev: jev.notes.join(" ") };`). In `run`, inside the `Object.assign(row, { ... error: ..., mb: mbTotal.toFixed(1), })` add `jev: r.jev || "",`.

In `src/merge.mjs`, so older shard files without the column still merge, replace `if (recs.length) columns ??= Object.keys(recs[0]);` with:

```js
  if (recs.length) columns = [...new Set([...(columns || []), ...Object.keys(recs[0])])];
```

- [ ] **Step 4: Verify fail-open, then live**

Run without a key: `PROXY_PLAN=local:no TYPESAFE_API_KEY= DEBUG=1 node src/scrape.mjs --ids askgamblers-00019 --force --concurrency 1`
Expected: `[debug] jev off picks:` and the row still has `terms_found,yes` with `jev,off`.

Run with the key (VPN on): `DEBUG=1 node --env-file=.env src/scrape.mjs --ids askgamblers-00359,askgamblers-00485,askgamblers-00608 --force --concurrency 3`
Expected: betico (`00359`) `jev` starts with `link:0.` and a Noul above 0.7 with the PDF picked; megafrenzy (`00485`) does not click the "T&Cs apply" caption first if Jev ranks something else, or its `jev` shows a low Noul; clubscasino (`00608`) shows `page:` with its verdict on `/terms-of-use/`. Read the `jev` column of the three rows and the debug lines; record what Jev answered in the commit message.

Run: `npm test` → 24 pass.

- [ ] **Step 5: Commit**

```bash
git add src/terms.mjs src/scrape.mjs src/merge.mjs
git commit -m "Let Jev pick the footer's terms link and judge pages the pattern rejects

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Breadth: cookie banners, parked domains, more guessed paths, sitemap indexes

The bar is every reachable casino. These four changes remove whole classes of misses before the acceptance loop.

**Files:**
- Modify: `src/terms.mjs` (`dismissCookies`, `readLobby`, `isParked`, the guess list and sitemap reading in `fetchTerms`)
- Modify: `src/scrape.mjs` (`parked` status), `README.md` (status list)
- Create: `tests/terms.test.mjs`

**Interfaces:**
- Produces: `dismissCookies(page)` → boolean (clicked something), `isParked(text)` → boolean, `PARKED_TEXT`; a new row status `parked`.

- [ ] **Step 1: Failing tests**

`tests/terms.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { dismissCookies, isParked } from "../src/terms.mjs";

test("isParked: for-sale and parking pages, not a casino that merely mentions a domain", () => {
  assert.equal(isParked("Skip to main content Excellent 4.5 out of 5 The domain name ScatterHall.com is for sale! Get this domain Own it today for $2,995, or make an offer."), true);
  assert.equal(isParked("English Copyright © 2026 GoDaddy Operating Company, LLC. Alle Rechte vorbehalten."), true);
  assert.equal(isParked("Welcome to Example Casino. " + "Play slots, live dealer games and sports. ".repeat(200) + "This domain is operated by Example N.V."), false);
});

const BANNER = `<!doctype html><html><body><main><a href="/terms">Terms and Conditions</a></main>
<div class="cookie-consent" id="cc"><p>We use cookies.</p><button onclick="document.getElementById('cc').remove()">Accept all</button><button>Settings</button></div></body></html>`;

test("dismissCookies clicks the banner's accept button, and reports nothing to click otherwise", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(BANNER);
    assert.equal(await dismissCookies(page), true);
    assert.equal(await page.evaluate(() => !!document.getElementById("cc")), false, "the banner is gone");
    assert.equal(await dismissCookies(page), false);
    await page.setContent("<html><body><button>Accept all</button></body></html>");
    assert.equal(await dismissCookies(page), false, "an accept button outside a cookie banner is not clicked");
  } finally { await browser.close(); }
});
```

Run: `node --test tests/terms.test.mjs` → fails: `dismissCookies` and `isParked` are not exported.

- [ ] **Step 2: Cookie banners and parked pages in `src/terms.mjs`**

Add above `readLobby`:

```js
// A cookie banner can cover the footer, and on some lobbies (bet25.dk) the consent text is all the page shows until it
// is accepted. Only a button inside something that calls itself a cookie, consent or GDPR element is clicked.
const CONSENT_TEXT = "^(accept( all| cookies| all cookies)?|agree|i agree|got it!?|ok(ay)?|allow( all)?( cookies)?|consent|continue|accepter|akzeptieren|alle akzeptieren|godkend( alle)?|hyväksy( kaikki)?|aceptar( todo)?|accetta( tutto)?|aceitar( todos)?|zgadzam się|accepteren|acceptera( alla)?|godta( alle)?)$";
export async function dismissCookies(page) {
  return page.evaluate((re) => {
    const r = new RegExp(re, "i");
    const inBanner = (el) => !!el.closest("[class*=cookie i], [id*=cookie i], [class*=consent i], [id*=consent i], [class*=gdpr i], [id*=gdpr i], [aria-label*=cookie i]");
    const btn = [...document.querySelectorAll("button, a, [role=button]")].find((el) => inBanner(el) && r.test((el.innerText || "").trim().replace(/\s+/g, " ")));
    if (!btn) return false;
    btn.click();
    return true;
  }, CONSENT_TEXT).catch(() => false);
}

// A parked or for-sale domain is not a casino: it gets its own status so it does not count as reached.
export const PARKED_TEXT = /domain (name )?(is )?for sale|buy this domain|this domain (is |has been )?(parked|registered)|parked (free|domain)|godaddy|sedo\.com|dan\.com|afternic|hugedomains|domain (has )?expired|make an offer/i;
export const isParked = (text) => text.length < 6000 && PARKED_TEXT.test(text.slice(0, 3000));
```

In `readLobby`, as the first line of the function body: `if (await dismissCookies(page)) await sleep(1500);`.

Run: `node --test tests/terms.test.mjs` → 2 pass.

- [ ] **Step 3: The `parked` status**

In `src/scrape.mjs` add `isParked` to the `./terms.mjs` import, and in `attempt` insert before the `dead_or_empty` line:

```js
    else if (isParked(text)) status = "parked"; // a for-sale page, not a casino
```

In the README's `status` row add `parked` (a for-sale or parking page) after `dead_or_empty`.

- [ ] **Step 4: More guessed paths, and sitemap indexes**

In `fetchTerms`, replace the block from `const guesses = [];` through the `for (const p of [...]) { ... }` loop that fills `guesses` with:

```js
  const guesses = [];
  // The sitemap, following an index to its first few child sitemaps (skipping game, blog and media sitemaps).
  const TERMS_URL = /terms|conditions|\btos\b|termos|\bagb\b|regulamin|user-?agreement|general-?rules/i, NOT_TERMS_URL = /privacy|cookie|bonus|promo|affiliate|sport|racing|poker|game|blog|news/i;
  const sitemap = async (u) => {
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 20000 });
      const xml = await page.evaluate(() => document.documentElement.outerHTML).catch(() => "");
      return { index: /<sitemapindex/i.test(xml), locs: [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]) };
    } catch { return { index: false, locs: [] }; }
  };
  let sm = await sitemap(`${origin}/sitemap.xml`);
  if (!sm.locs.length) sm = await sitemap(`${origin}/sitemap_index.xml`);
  const pools = [];
  if (sm.index) { for (const child of sm.locs.filter((l) => !/product|game|slot|blog|news|image|video|post/i.test(l)).slice(0, 3)) pools.push((await sitemap(child)).locs); }
  else pools.push(sm.locs);
  for (const loc of pools.flat()) { if (TERMS_URL.test(loc) && !NOT_TERMS_URL.test(loc)) guesses.push(loc); if (guesses.length >= 4) break; }
  // The paths casinos commonly use, with the lobby's language prefix and without it.
  for (const p of ["/terms-and-conditions", "/terms", "/terms-of-service", "/terms-of-use", "/terms-conditions", "/general-terms-and-conditions", "/info/terms-and-conditions", "/help/terms-and-conditions", "/legal/terms", "/legal/terms-and-conditions", "/pages/terms-and-conditions", "/page/terms-and-conditions", "/user-agreement", "/rules", "/tc"]) {
    guesses.push(`${origin}${lang}${p}`);
    if (lang) guesses.push(`${origin}${p}`);
  }
```

Then change `const guessUntil = Date.now() + 120000; // the whole guessing phase gets two minutes` to `const guessUntil = Date.now() + 180000; // the whole guessing phase gets three minutes` and `[...new Set(guesses)].slice(0, 6)` to `[...new Set(guesses)].slice(0, 12)`.

- [ ] **Step 5: Verify**

Run: `npm test` → 26 pass.
Run (VPN on): `DEBUG=1 node --env-file=.env src/scrape.mjs --ids casinoguru-04603,askgamblers-01140 --force --concurrency 2`
Expected: bet25.dk (`04603`) no longer shows only cookie text in `footer` and has a terms candidate in the debug line; scatterhall (`01140`) ends with `status,parked`.

- [ ] **Step 6: Commit**

```bash
git add src/terms.mjs src/scrape.mjs tests/terms.test.mjs README.md
git commit -m "Dismiss cookie banners, mark parked domains, guess more paths, follow sitemap indexes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Retry ids and the Browserless fallback on Actions

**Files:**
- Create: `src/retry-ids.mjs`, `tests/retry-ids.test.mjs`
- Modify: `.github/workflows/scrape.yml`, `README.md`

**Interfaces:**
- Produces: `retryIds(rows)` → ids whose `status !== "ok"` or `terms_found === "no"`; the CLI writes `input/retry-ids.txt`. The workflow's `only_ids` accepts `@input/retry-ids.txt`.

- [ ] **Step 1: Failing test**

`tests/retry-ids.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { retryIds } from "../src/retry-ids.mjs";

test("retryIds: every casino not reached, and every reached one without terms", () => {
  const rows = [
    { id: "a", status: "ok", terms_found: "yes" },
    { id: "b", status: "ok", terms_found: "no" },
    { id: "c", status: "geo_blocked", terms_found: "" },
    { id: "d", status: "timeout", terms_found: "" },
    { id: "e", status: "no_url", terms_found: "" },
    { id: "f", status: "parked", terms_found: "" },
  ];
  assert.deepEqual(retryIds(rows), ["b", "c", "d"]);
});
```

`no_url` and `parked` rows have nothing to retry. Run: `node --test tests/retry-ids.test.mjs` → fails, module not found.

- [ ] **Step 2: Write `src/retry-ids.mjs`**

```js
// Lists the casinos a local run could not finish, for a Browserless run on Actions: dispatch "Scrape casino terms"
// with only_ids = @input/retry-ids.txt after committing the file.
// Usage: node src/retry-ids.mjs [out/results.csv]  -> input/retry-ids.txt
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

/** Not reached, or reached without terms. A casino with no URL, or a parked domain, has nothing to retry. */
export function retryIds(rows) {
  return rows.filter((r) => !["no_url", "parked"].includes(r.status) && (r.status !== "ok" || r.terms_found === "no")).map((r) => r.id);
}

if (process.argv[1] && process.argv[1].endsWith("retry-ids.mjs")) {
  const file = process.argv[2] || "out/results.csv";
  const rows = parse(readFileSync(file), { columns: true, skip_empty_lines: true });
  const ids = retryIds(rows);
  writeFileSync("input/retry-ids.txt", ids.join("\n") + "\n");
  const tally = {};
  for (const r of rows) if (ids.includes(r.id)) { const k = r.status === "ok" ? "ok/no terms" : r.status; tally[k] = (tally[k] || 0) + 1; }
  console.log(`${ids.length} of ${rows.length} casinos to retry -> input/retry-ids.txt`, tally);
}
```

Run: `node --test tests/retry-ids.test.mjs` → 1 pass.

- [ ] **Step 3: The workflow reads ids from a file and passes the Jev key**

In `.github/workflows/scrape.yml`, change the `only_ids` input description to `"Optional: comma-separated job ids to (re)run, or @input/retry-ids.txt for the ids in that file (one per line)"`. Replace the "Scrape shard" step with:

```yaml
      - name: Scrape shard ${{ matrix.shard }}
        env:
          BROWSERLESS_TOKEN: ${{ secrets.BROWSERLESS_SECRET }}
          BROWSERLESS_REGION: ${{ vars.BROWSERLESS_REGION || 'production-sfo' }}
          EXIT_COUNTRIES: ${{ vars.EXIT_COUNTRIES || 'ca,de,nz,fi,ie,br,jp,in' }}
          PROXY_PLAN: ${{ vars.PROXY_PLAN || '' }}
          TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
          ONLY_IDS: ${{ inputs.only_ids }}
        run: |
          IDS="$ONLY_IDS"
          case "$IDS" in @*) IDS=$(grep -v '^#' "${IDS#@}" | tr -s '\n' ',' | sed 's/,$//');; esac
          [ -n "$IDS" ] && IDS="--ids $IDS"
          node src/scrape.mjs --shard "${{ matrix.shard }}" --shards "${{ inputs.shards }}" --concurrency "${{ inputs.concurrency }}" --deadline-minutes 320 $IDS
```

- [ ] **Step 4: README**

Under "Running it", renumber the existing steps 1–3 as the Browserless run and add before them:

````markdown
### The whole set: local first, Browserless for the rest

1. Run the local pass (see "Locally" below) and merge: `node src/merge.mjs` → `out/results.csv`.
2. `node src/retry-ids.mjs` writes `input/retry-ids.txt`: every casino not reached, or reached without terms. Commit
   and push it.
3. Actions → **Scrape casino terms** → `only_ids` = `@input/retry-ids.txt`. Add the `TYPESAFE_API_KEY` repository
   secret first so Jev runs there too.
4. Download the **results** artifact and merge the two: `mkdir -p out/final && cp out/results.csv
   out/final/shard-previous.csv && cp ~/Downloads/results.csv out/final/shard-0.csv && node src/merge.mjs out/final`.
   Only the retried casinos come back from Actions, and a later row replaces the earlier one, so the local successes
   stand.
````

In the "What a result row holds" table add a row: `| `jev` | what Jev (TypeSafe AI) answered: `link:<P there is a terms link>/<P of its pick>`, `page:<P this page is the terms>` per page it judged, `off` without a key, `error:…` when the call failed |`. In "How it reads a casino" step 4 add after the scoring sentence: "Jev is shown the footer's links and clickable texts and asked which is the general terms; when it is confident one exists its pick is tried first (`via jev`). A page the terms pattern rejects is judged by Jev before it is given up on. Terms hidden in collapsed sections are read from the DOM (`hidden text`), and PDFs are read with pdf.js (`pdf`)."

- [ ] **Step 5: Verify**

Run: `node src/retry-ids.mjs out/full1/results.csv` → expected: `214 of 718 casinos to retry -> input/retry-ids.txt` with a tally showing `'ok/no terms': 116`, `geo_blocked: 14`, `blocked_http: 26`, `dead_or_empty: 34`, `load_error: 24`. (Counts from the run of 2026-10-28; a later file differs.)
Run: `IDS=@input/retry-ids.txt; IDS=$(grep -v '^#' "${IDS#@}" | tr -s '\n' ',' | sed 's/,$//'); echo "$IDS" | tr ',' '\n' | wc -l` → 214.
Run: `npm test` → 27 pass.

- [ ] **Step 6: Commit**

```bash
git add src/retry-ids.mjs tests/retry-ids.test.mjs .github/workflows/scrape.yml README.md
git commit -m "Retry ids for the Browserless pass, read from a file by the workflow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The probe script

**Files:**
- Create: `src/probe-jev.mjs`

**Interfaces:**
- Consumes: `readLobby`, `settle`, `fetchTerms` from `src/terms.mjs`; `linkEntries`, `termsLinkQuestions`, `askJev` from `src/jev.mjs`.

- [ ] **Step 1: Write it**

```js
// Shows what the terms search does for one casino, Jev's view included: opens the lobby in the local Chrome exactly
// as scrape.mjs does, prints the scored anchors, the entries Jev is shown and its answers, then runs the full
// search and prints what it found and what it tried.
// Usage: node --env-file=.env src/probe-jev.mjs <url> [--headed]
import { chromium } from "playwright-core";
import { settle, readLobby, fetchTerms, clip } from "./terms.mjs";
import { termsCandidates } from "./links.mjs";
import { linkEntries, termsLinkQuestions, askJev, jevPicks } from "./jev.mjs";

const url = process.argv[2];
if (!url) throw new Error("usage: node --env-file=.env src/probe-jev.mjs <url> [--headed]");
process.env.DEBUG ||= "1";
const browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed"), args: ["--disable-blink-features=AutomationControlled"] });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(page, resp ? resp.status() : 0);
  const lobby = await readLobby(page);
  console.log(`lobby ${lobby.url}: ${lobby.links.length} links, footer ${lobby.footer.length} chars`);
  console.log("scored:", termsCandidates(lobby.links, lobby.url).slice(0, 6).map((c) => `${c.score} ${c.href} "${c.text.slice(0, 30)}"`).join(" | ") || "none");
  const entries = linkEntries(lobby);
  console.log(`jev entries (${entries.length}):`);
  for (const e of entries) console.log(`  ${e.id.padEnd(28)} ${e.kind} "${e.text}" ${e.href}${e.in_footer ? " [footer]" : ""}`);
  const q = termsLinkQuestions(entries);
  const answers = entries.length ? await askJev(q.state, q.questions) : null;
  if (!answers) console.log("jev: off (no TYPESAFE_API_KEY)");
  else {
    console.log(`jev: has_terms ${answers.has_terms.noul.toFixed(2)}; choice ${answers.terms_link.choice} (confidence ${(answers.terms_link.confidence ?? 0).toFixed(2)})`);
    console.log("  probabilities:", Object.entries(answers.terms_link.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, p]) => `${k} ${p.toFixed(2)}`).join(" | "));
    console.log("  picks:", jevPicks(answers, entries).map((p) => `"${p.text}" ${p.href}`).join(" | ") || "none");
  }
  const jev = { notes: [] };
  const terms = await fetchTerms(page, lobby, jev);
  console.log(terms.text ? `FOUND via ${terms.via}: ${terms.href}${terms.hidden ? " (hidden text)" : ""}${terms.pdf ? " (pdf)" : ""} ${terms.text.length} chars\n  ${clip(terms.text, 300)}` : "NOT FOUND");
  console.log("tried:", terms.tried.join(" | ") || "nothing");
  console.log("jev notes:", jev.notes.join(" "));
} finally { await browser.close(); }
```

- [ ] **Step 2: Run it against the failing casinos (VPN on)**

```bash
for u in https://crusado-e.com/ https://spinit.com/ https://betico.pro/ https://ab.betrivers.ca/?page=landing https://megafrenzy.com/ https://clubscasino.com/ https://dexsport.io/ https://www.jamslots.com/ https://betportal.com/en/home; do echo "===== $u"; node --env-file=.env src/probe-jev.mjs "$u" 2>&1 | grep -vE "^\[debug\] (link|guess) " ; done
```

Expected: `FOUND` for crusado, spinit (hidden text), betico (pdf), dexsport (pdf). For the others, read Jev's `has_terms` and picks: a Noul under 0.7 on a lobby that has no terms link is correct behaviour; a high Noul with a wrong pick is a wording problem. If the pick is wrong on two or more of these, adjust the `false` criterion of `has_terms` or the option description in `termsLinkQuestions` (the words are all in `src/jev.mjs`), re-run `npm test`, and re-run the probe. Note each casino's outcome in the commit message.

- [ ] **Step 3: Commit**

```bash
git add src/probe-jev.mjs src/jev.mjs
git commit -m "Probe script: what the terms search and Jev make of one casino

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Acceptance loop: every reachable casino

The bar: after the run, every row with `status = ok` has `terms_found = yes`, or its `terms_tried` ends in `(wall)` (bot-walled terms page, handed to the Browserless pass). Any other `ok` row without terms is a defect. Keep notes for the user.

- [ ] **Step 1: Pilot of the local phase**

```bash
node src/jobs.mjs
node -e 'const {parse}=require("csv-parse/sync");const r=parse(require("fs").readFileSync("out/full1/results.csv"),{columns:true}).filter(x=>x.terms_found==="yes").slice(0,30).map(x=>x.id);console.log(r.join(","))' > out/ok30.txt
node --env-file=.env src/scrape.mjs --ids "$(cat out/ok30.txt)" --force --concurrency 6 2>&1 | tee out/pilot-local.log
```

Expected: every one of the 30 previously successful casinos ends `ok … local-no` with `terms_found,yes` (compare with `grep -c ",yes," out/results/shard-0.csv`); no `challenge` status; the log's first line names Norway (`NO`). Count the `challenge` and `blocked_http` rows; three or more of 30 means headless Chrome is being detected: re-run with `LOCAL_HEADLESS=false` and compare.

- [ ] **Step 2: The 116 failures**

```bash
node -e 'const {parse}=require("csv-parse/sync");const r=parse(require("fs").readFileSync("out/full1/results.csv"),{columns:true}).filter(x=>x.status==="ok"&&x.terms_found==="no").map(x=>x.id);console.log(r.join(","))' > out/no116.txt
node --env-file=.env src/scrape.mjs --ids "$(cat out/no116.txt)" --force --concurrency 6 2>&1 | tee out/retry-local.log
node src/merge.mjs && node src/report.mjs out/results.csv out/retry-report.html "Local retry of the 116"
```

Tally, and list every `ok` row without terms whose `terms_tried` does not end in `(wall)`:

```bash
node -e 'const {parse}=require("csv-parse/sync");const ids=new Set(require("fs").readFileSync("out/no116.txt","utf8").trim().split(","));const r=parse(require("fs").readFileSync("out/results.csv"),{columns:true}).filter(x=>ids.has(x.id));const t={};for(const x of r){const k=x.status+"/"+(x.terms_found||"-");t[k]=(t[k]||0)+1}console.log(r.length,t);const via={};for(const x of r)for(const m of (x.pages||"").matchAll(/terms \S+( \(via \w+\))?( \(hidden text\))?( \(pdf\))?/g))via[(m[1]||" (via link)")+(m[2]||"")+(m[3]||"")]=(via[(m[1]||" (via link)")+(m[2]||"")+(m[3]||"")]||0)+1;console.log(via);const miss=r.filter(x=>x.status==="ok"&&x.terms_found==="no"&&!/\(wall\)\s*$/.test(x.terms_tried||""));console.log("DEFECTS",miss.length);for(const x of miss)console.log(" ",x.id,x.casino,x.final_url,"|",x.jev,"|",(x.terms_tried||"").slice(0,200))'
```

- [ ] **Step 3: Fix every defect, generically, until the list is empty**

For each id in the `DEFECTS` list:

1. Probe it: `node --env-file=.env src/probe-jev.mjs "<final_url>" 2>&1 | tee out/probe-<id>.log`, and read `out/text/<id>.txt`.
2. Classify the cause as one of: the link is on the page but neither the scorer nor Jev's entries carry it (fix: `linkEntries` or `termsScore` in a way stated as a rule, with a test); Jev had it but answered wrongly (fix: the wording or criteria in `src/jev.mjs`, then re-run `tests/jev.test.mjs` and the probe on two previously correct lobbies to check nothing moved); the page was reached but rejected (fix: `readDoc`, `hiddenText`, `isTermsPage`, with a fixture test); the terms live somewhere the search never looks (fix: a new guessed path or a new step in `fetchTerms`, with a test where the logic is pure); the landing page is an affiliate page with no legal links and the bare domain was not tried (fix: the URL list in `run`); the page is not a casino at all (fix: `PARKED_TEXT` or `BLOCK_TEXT`, with a test, so it stops counting as reached).
3. Re-run that id with `--force`, then the full `out/no116.txt` list and the `out/ok30.txt` sample again. Commit each fix on its own with the casino named in the message.
4. A cause that only a rule naming that one casino would fix is not fixed. It goes into the report with the probe output, for the user to decide.

Stop when the `DEFECTS` list holds only the listed casino-specific cases, and the 30-casino sample is still all `yes`.

- [ ] **Step 4: Report to the user**

Write the two tallies (30 regression ids, 116 retry ids), the `via` breakdown (link / jev / click / signup-page / guess / promo-terms, hidden text, pdf), the walled ids handed to the Browserless pass, the casino-specific cases left for the user with what the probe showed, the challenge count from the pilot, and the path `out/retry-report.html`. Open questions for the user: headless or headed for the full run; the concurrency to use for the full set.

- [ ] **Step 5: Commit the notes**

Add the tallies to the spec's "Why" section as a "Result" paragraph and commit:

```bash
git add docs/superpowers/specs/2026-10-29-local-first-scrape-and-jev-terms-design.md
git commit -m "Spec: results of the local retry of the 116 failures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
