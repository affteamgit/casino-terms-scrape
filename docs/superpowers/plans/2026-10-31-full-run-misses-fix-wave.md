# Full-run misses fix wave 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 719 reached-without-terms rows of the 2026-10-30 full run into stored terms or an honest terminal status, with generic rules only.

**Architecture:** Seven independent changes to the terms search (`src/terms.mjs`), link scoring (`src/links.mjs`), the Jev client (`src/jev.mjs`) and the result tooling (`src/merge.mjs`, `src/retry-ids.mjs`, `src/report.mjs`, `src/scrape.mjs`). Each change is specified by the spec section it implements and lands with its tests; the confirmation pass at the end reruns the misses.

**Tech Stack:** Node ≥ 22.13 ESM, playwright-core on the installed Chrome, `node --test`, TypeSafe Jev (`jev-1.14.0`).

**Spec:** `docs/superpowers/specs/2026-10-31-full-run-misses-fix-wave-design.md` — read the section named by each task; it is the authority.

## Global Constraints

- No casino-specific rule: every rule must be stated in terms of page shape, text or URL pattern that generalises. A fixture may be modelled on a real casino.
- Never store a promotion's, bonus, product-section or policy page as the general terms. Every accept path either passes `readsLikeTerms` on a link the heuristic scores above 0, or passes Jev's page judgment (`isTermsPage`).
- Fail open on Jev: no key or a failed call leaves the existing regex behaviour; a Jev-only path is skipped, never regex-accepted.
- Secrets: `.env` is read with `node --env-file=.env`; never print, log, cat or commit it; never echo environment variables.
- Tests run with `npm test` (`node --test`); the suite is green before every commit; new behaviour gets a test in `tests/`.
- Node ≥ 22.13 (`package.json` engines); macOS has no `timeout` command.
- Commit after each task with a message that states the rule added, as the existing history does.

---

### Task 1: Terminal lobby statuses `closed`, `not_casino`, broader geo/WAF/marketplace detection, and their plumbing

**Spec:** §1 (regex part), the `merge.mjs` / `retry-ids.mjs` / `report.mjs` paragraph.

**Files:**
- Modify: `src/terms.mjs` (`BLOCK_TEXT`, `lobbyStatus`, `marketplaceLobby`)
- Modify: `src/scrape.mjs` (status list / comments where statuses are enumerated), `src/merge.mjs` (`better`), `src/retry-ids.mjs`, `src/report.mjs`, `README.md` (status table)
- Test: `tests/terms.test.mjs`, `tests/merge.test.mjs`, `tests/retry-ids.test.mjs`

**Interfaces:**
- Produces: `lobbyStatus(text, anchors, finalUrl, …)` may return `"closed"`; `BLOCK_TEXT`, `CLOSED_TEXT`, `WAF_TEXT` exported from `src/terms.mjs`; `MARKETPLACE_HOSTS` exported; `better()` ranks `parked`, `closed`, `not_casino` equal to `ok` without terms; `retry-ids` skips those three.
- Consumes: nothing new.

- [ ] **Step 1: Failing tests for `lobbyStatus`** — in `tests/terms.test.mjs` add cases (use the existing `lobbyStatus` call shape; read its signature first):
  - "Important notice: Please note that 888's services are not being offered to players residing in your location." → `geo_blocked`
  - "MR GREEN UNAVAILABLE IN YOUR LOCATION Thank you for choosing Mr Green…" → `geo_blocked`
  - "Dear visitor! Due to a management decision, the services of this website are unfortunately no longer available for customers residing in your country." → `geo_blocked` (the geo form wins over the closed form: "residing in your country" is present)
  - "Governo Federal Acesso bloqueado A plataforma de apostas que você tentou acessar está fora do ar por determinação da Medida Provisória nº 1.394/2026" → `geo_blocked`
  - "Ограничение местоположения По юридическим причинам мы не можем принять игроков, проживающих в стране, в которой вы в данный момент находитесь." → `geo_blocked`
  - "EUROPACASINO.COM NO LONGER AVAILABLE Sorry! Europacasino.com is now closed for business. For further information…" → `closed`
  - "Požadovaná URL adresa bola zamietnutá. Kontaktujte prosím IT podporu. Vaše ID pre podporu je: <678628845435775204>" → `blocked_http`
  - "Access Denied You don't have permission to access \"http://forsale.godaddy.com/forsale/x.com?\" on this server. Reference #18.b48e655f" with finalUrl `https://forsale.godaddy.com/forsale/x.com` → `parked` (marketplace host wins over the WAF text)
  - A normal lobby with "Terms and Conditions" in the footer → `ok` (unchanged)
- [ ] **Step 2: Run** `node --test tests/terms.test.mjs` — expect the new cases to fail.
- [ ] **Step 3: Implement** in `src/terms.mjs`: extend `BLOCK_TEXT` with the spec's forms (English, Portuguese, Russian, Spanish, German, French, Italian, Turkish); add `export const CLOSED_TEXT = /closed for business|no longer (available|operating|accepting|in operation)|has (been )?(closed|discontinued)|ceased (operations|trading)|permanently closed|site (is|has) closed|cessé ses activités|geschlossen|chiuso definitivamente|cerrado permanentemente/i` and `export const WAF_TEXT = /access denied|request (was )?(blocked|rejected)|reference #\d|incident id|errors\.edgesuite\.net|zamietnut|zamítnut/i`; add `export const MARKETPLACE_HOSTS = /(^|\.)(forsale\.godaddy\.com|sedo\.com|dan\.com|afternic\.com|hugedomains\.com|parkingcrew\.net)$/i`. In `lobbyStatus`, order: marketplace host → `parked`; `BLOCK_TEXT` → `geo_blocked`; `WAF_TEXT` in the first 2,000 characters with text < 3,000 → `blocked_http`; `CLOSED_TEXT` in the first 3,000 characters with text < 5,000 and no own-domain terms candidate ≥ 5 → `closed`; then the existing rules. Keep `maintenance` as is.
- [ ] **Step 4: Run the terms tests** — pass.
- [ ] **Step 5: Failing tests for merge and retry-ids** — `tests/merge.test.mjs`: a casino with `parked` in shard 0 and `ok`/`no` in shard 1 keeps the later row (equal rank); `closed` beats `blocked_http`; `ok`/`yes` beats `not_casino`. `tests/retry-ids.test.mjs`: rows with `closed` and `not_casino` are not listed; a row `ok`/`yes` whose `jev` column contains `error:jev http 529` **is** listed with reason `jev-failed` (spec §7, done here so the tooling lands together).
- [ ] **Step 6: Implement** `better()` ranks; `retry-ids` exclusions and the `jev-failed` group (reason column or comment line as the file already does — read it first); `report.mjs` section "Not a casino / not operating" listing `parked`, `closed`, `not_casino`; `scrape.mjs` status enumeration comment and `README.md` status table rows for `closed` and `not_casino`.
- [ ] **Step 7: `npm test`** — green. **Commit:** "Statuses closed and not_casino; geo notices in seven languages, WAF refusals and marketplace error pages classified; merge/retry/report know the new statuses".

---

### Task 2: Jev lobby judgment when no terms link or clickable is found

**Spec:** §1, "Jev lobby judgment".

**Files:**
- Modify: `src/jev.mjs` (`lobbyQuestion`, `lobbyVerdict`), `src/terms.mjs` (`fetchTerms`: ask when `!cands.length && !lobby.clickables.length` and the regex status is `ok`; return `lobbyClass`), `src/scrape.mjs` (map `lobbyClass` to status; `jev` column note)
- Test: `tests/jev.test.mjs`, `tests/terms.test.mjs`

**Interfaces:**
- Produces: `lobbyQuestion({ url, title, text, captions })` → `{ state, questions }` with one Choice question `kind` whose options are exactly `gambling_site`, `geo_or_regulatory_notice`, `closed_or_suspended`, `parked_or_for_sale`, `not_gambling_site`, `error_or_bot_wall`; `lobbyVerdict(answers)` → one of `"geo_blocked" | "closed" | "parked" | "not_casino" | "blocked_http" | null` (null for `gambling_site`, p < 0.8 or noul < 0.7, or no answers); `fetchTerms` result gains `lobbyClass: string | null` and the note `lobby:<option>:<p>` in `jev.notes`.
- Consumes: `askJev`, `jevEnabled`, the `jev.ask || askJev` injection used by the terms tests.

- [ ] **Step 1: Failing tests** — `tests/jev.test.mjs`: `lobbyQuestion` state carries `url`, `title`, the first 3,000 characters of text and up to 60 captions; `lobbyVerdict({ kind: { type: "choice", noul: 0.9, choices: { not_gambling_site: 0.92, gambling_site: 0.05, … } } })` → `"not_casino"`; p 0.7 → null; noul 0.5 → null; `gambling_site` 0.95 → null. (Read `jevPicks`/`acceptsPage` for the answer shape the client already parses; mirror it.) `tests/terms.test.mjs`: a lobby fixture with no terms link and an injected `jev.ask` returning `not_gambling_site` 0.9 → `fetchTerms` result `lobbyClass === "not_casino"` and `found` falsy; the same fixture with a terms link → Jev's lobby question is never asked (assert the injected ask saw no `kind` question).
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement.** Question instructions: "What is `page`?" with option descriptions from the spec. Call site in `fetchTerms`: right where `tried.unshift("no terms link or text on the lobby")` is pushed, when `jevEnabled() && !jevDown`; wrap with the existing `failed(e)` handling. `scrape.mjs`: when the result carries `lobbyClass` and the row status is `ok`, set status to it (and `terms_found` stays `no`).
- [ ] **Step 4: Run** — pass. `npm test` green. **Commit:** "Jev classifies a lobby with no terms link: geo notice, closed, parked, not a gambling site or error page become statuses; a gambling site stays ok".

---

### Task 3: Jev sees every footer link; terms words in 25 more languages

**Spec:** §2.

**Files:**
- Modify: `src/jev.mjs` (`linkEntries`, `LEGAL`), `src/links.mjs` (`TERMS_TEXT`), `src/terms.mjs` (`TERMS_WORDS`, `CLICK_TEXT`, `readLobby`'s caption read: `aria-label`, `title`, image `alt`)
- Test: `tests/jev.test.mjs`, `tests/links.test.mjs`, `tests/terms.test.mjs`

**Interfaces:**
- Produces: `linkEntries` order: footer links (any caption) → clickables → non-footer `LEGAL` links; cap 60 unchanged. `TERMS_TEXT`/`TERMS_WORDS`/`LEGAL`/`CLICK_TEXT` match the spec's word list.
- Consumes: nothing new.

- [ ] **Step 1: Failing tests** — `tests/jev.test.mjs`: a lobby with footer links captioned "Uslovi korišćenja" (`/uslovi-koriscenja`), "Genel Şartlar ve Kurallar" (`/sartlar`), "الشروط والأحكام" (`/ar/terms`), "ข้อกำหนดและเงื่อนไข" (`/th/tnc`) and "Blackjack" (`/games/blackjack`) → all five appear in `linkEntries` (footer links are admitted whatever their caption), in footer order, before any non-footer link; a non-footer link "Slots" is not admitted while a non-footer "Legal" is. `tests/links.test.mjs`: `termsCandidates` scores a link captioned "Uslovi korišćenja" above 0; "Allgemeine Geschäftsbedingungen" already does (keep); "利用規約" above 0. `tests/terms.test.mjs`: `readsLikeTerms` on a 2,500-character Serbian text with six "uslovi"/"pravila" words → true; `CLICK_TEXT` matches "Şartlar ve Koşullar".
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement.** Add the spec's words to the four regexes (one alternation each, grouped by language with a comment; non-Latin words as plain substrings, Latin words with `\b` where the existing regex uses it). `linkEntries`: first loop admits every footer link with a caption (`add(l.text, l.href, true, "link")`), the `legal(l)` test moves to the non-footer loop only. `readLobby`'s link read: caption = `innerText || aria-label || title || (img alt)`.
- [ ] **Step 4: Run** — pass; `npm test` green. **Commit:** "Jev is shown every footer link, and the terms words of 25 more languages reach the heuristic, the page gate and the click texts".

---

### Task 4: A click that opens a new tab or an iframe; a document inside a frame

**Spec:** §3.

**Files:**
- Modify: `src/terms.mjs` (`clickOpen`, `readDoc`, new `frameText(page, want)` helper)
- Test: `tests/terms.test.mjs` (browser fixtures served by the existing test server helper — read how the lobby-shell/modal fixtures are served)

**Interfaces:**
- Produces: `frameText(page, want, minChars = 1500)` → `{ text, url } | null` (longest frame text passing `want`, excluding PDF frames); `readDoc` result may carry `frame: true`; `clickOpen` reads a popup page and closes it.
- Consumes: `isTermsPage`, `fastInPlace`, `readsLikeTerms`, `pageMeta`.

- [ ] **Step 1: Failing browser tests** — fixture A: a lobby whose footer has `<a href="#" onclick="window.open('/terms-popup.html')">Terms & Conditions</a>` and `/terms-popup.html` holds 3,000+ characters of terms with six terms words → `fetchTerms` finds terms with `href` ending `/terms-popup.html`, `via: "click"`, and the browser context has one page left afterwards. Fixture B: a footer button that un-hides a modal containing `<iframe src="/terms-frame.html">` (3,000+ characters of terms, page text otherwise unchanged) → found, text from the frame. Fixture C: a navigated page `/terms.html` whose body holds 200 characters and an iframe with the terms → found with `frame: true` path (assert the stored text contains a sentence only in the frame).
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement.** `clickOpen`: `const popup = page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null)` registered before the script click; after the wait loop, `const np = await popup`; if `np`: `await np.waitForLoadState("domcontentloaded").catch(() => {})`, `d = await readDoc(np, 35000, readsLikeTerms)`, judge with `isTermsPage(d.text, await pageMeta(np), { fast: true })`, build the result with `href: np.url()`, `via: "click"`, then `await np.close().catch(() => {})` in a `finally`. If no popup and not navigated and not `changed`: `const f = await frameText(page, readsLikeTerms)`; if `f`, judge `isTermsPage(f.text, { ...await pageMeta(), url: f.url || at }, { fast: fastInPlace(f.text) })`. `frameText`: `for (const fr of page.frames()) if (fr !== page.mainFrame())` evaluate `document.body?.innerText || ""` with `.catch(() => "")`; skip frames whose `fr.url()` matches `/\.pdf(\?|$)/i`; return the longest passing `want` and `>= minChars`. `readDoc`: before the final `return` when the visible text fails, `const f = await frameText(page, want); if (f) return { ok: true, text: f.text, frame: true, frameUrl: f.url }`.
- [ ] **Step 4: Run** — pass; `npm test` green. **Commit:** "A terms click that opens a new tab or fills an iframe is read; a document whose body is an iframe is read from the frame".

---

### Task 5: A shell that hides or delays the document

**Spec:** §4.

**Files:**
- Modify: `src/terms.mjs` (`tryLink`: `readDoc` `want`, the shell branch)
- Test: `tests/terms.test.mjs`

- [ ] **Step 1: Failing browser tests** — fixture D: `/terms.html` renders the lobby's header and footer at once and appends 4,000 characters of terms after 4 seconds (`setTimeout`) → found (today: rejected as lobby shell). Fixture E: `/terms.html` shows the lobby's header, a 300-character intro, and 60,000 characters of terms inside `<details>` elements that are closed (hidden text) → found, `hidden: true` or via `expandSections`. Fixture F (regression): `/404` that is the lobby shell with 200 characters of "not found" → still `(lobby shell)`, not found.
- [ ] **Step 2: Run** — fail (D and E).
- [ ] **Step 3: Implement.** In `tryLink`: `let d = await readDoc(page, c.english ? 15000 : 35000, (t) => readsLikeTerms(t) && !isShellOf(t, lobbyRef, lobbyText));`. In the shell branch, before `retryUnblocked`: `if (await expandSections(page)) { d = await readDoc(page, 10000, want); if (!shell(d)) /* fall through to the normal judgment */ }`; then `const h = await page.evaluate(hiddenTextInPage).catch(() => "")`; `if (h && !isShellOf(h, lobbyHidden, lobbyHiddenText) && readsLikeTerms(h) && await isTermsPage(h, await pageMeta(), { fast: !jevOnly(c), jevOnly: jevOnly(c) })) return fuller({ href: page.url(), text: h, via: c.jev ? "jev" : "link", hidden: true, tried })`. Structure it so the "fell out of shell" case re-enters the normal `good` judgment rather than duplicating it (a small `judge(d)` closure).
- [ ] **Step 4: Run** — pass; `npm test` green. **Commit:** "A page that is still the lobby shell keeps being read until the budget; a shell over hidden or collapsed terms yields them".

---

### Task 6: Jev judges the document's core text; a borderline page gets an exclusion question; low-scored links are Jev's alone; the general terms next to a bonus page are guessed

**Spec:** §5 and §6.

**Files:**
- Modify: `src/jev.mjs` (`termsPageQuestion` accepts `core`; new `exclusionQuestion`, `acceptsBorderline`; `PAGE_NOUL_BORDER = 0.5`, `EXCLUSION_MAX = 0.3`), `src/terms.mjs` (`isTermsPage`, the low-score pass, rejected-URL sibling guesses), `src/links.mjs` (`siblingGuesses` from a promo/product URL)
- Test: `tests/jev.test.mjs`, `tests/terms.test.mjs`, `tests/links.test.mjs`

**Interfaces:**
- Produces: `exclusionQuestion({ url, title, headings, text })` → `{ state, questions: { not_general: { type: "noul", … } } }`; `acceptsBorderline(pageAnswers, exclusionAnswers, text)` → boolean; `promoSiblingGuesses(url)` in `links.mjs` → string[]; `pageSummary` prints `page:0.65 excl:0.12` when both were asked.
- Consumes: `coreText`, `readsLikeTerms`, `SIBLING_NAMES`, `PROMO`, `PRODUCT`.

- [ ] **Step 1: Failing tests** — `tests/jev.test.mjs`: `termsPageQuestion({ …, text, core: true })` state has `page.core === true`; `acceptsBorderline({ is_terms: { noul: 0.65 } }, { not_general: { noul: 0.12 } }, longTermsText)` → true; with `not_general` 0.4 → false; with `is_terms` 0.45 → false; with `is_terms` 0.65 and text that fails `readsLikeTerms` → false. `tests/terms.test.mjs` (injected `jev.ask`): a candidate page whose `is_terms` answer is 0.65 and `not_general` 0.1 → found; `is_terms` 0.65 and `not_general` 0.5 → not found; the text Jev receives for a page under the lobby's header is the core text (assert the injected ask saw state text that does not start with the lobby's header); a casino whose only terms-like link scores ≤ 0 with Jev down → that link is not opened (`tried` has no entry for it) and the `promo-terms` via never appears; with Jev up and Jev's page answer 0.95 → found with `via: "low-score link"`. `tests/links.test.mjs`: `promoSiblingGuesses("https://x.com/en/terms/bonus/")` includes `https://x.com/en/terms/`; `promoSiblingGuesses("https://x.com/help/bonus-terms-and-conditions")` includes `https://x.com/help/terms-and-conditions` and `https://x.com/help/terms`; a non-promo URL → `[]`.
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement.** `isTermsPage(text, meta, opts)`: `const core = coreText(text, lobbyText); const sent = core.length >= 1500 ? core : text;` build `termsPageQuestion({ ...meta, text: sent, core: sent === core })`; after the answer: if `acceptsPage` → true; else if `noul >= 0.5` ask `exclusionQuestion` with the same state and return `acceptsBorderline(answers, excl, text)`; note both. Low-score pass: guard with `jevUp`, call `tryLink` with a flag that makes `isTermsPage` run `{ fast: false, jevOnly: true }`, `via: "low-score link"`. Sibling guesses: in `tryLink`'s rejection path (`tried.push(\`${c.href} (${…})\`)`), when `PROMO.test(path) || PRODUCT.test(path words)`, push `promoSiblingGuesses(page.url())` onto the guess list (deduped, before the common paths; respect the budget).
- [ ] **Step 4: Run** — pass; `npm test` green. **Commit:** "Jev reads a page's own text, a borderline page is accepted only when Jev also rules out the exclusions, a low-scored link is Jev's alone, and a bonus page's general-terms siblings are guessed".

---

### Task 7: Jev retries overloads

**Spec:** §7 (client part; `retry-ids` part landed in Task 1).

**Files:**
- Modify: `src/jev.mjs` (`askJev`: injectable `fetch` and `sleep`, backoff 2 s / 5 s / 10 s on 429, 5xx, 529 and network failure)
- Test: `tests/jev.test.mjs`

- [ ] **Step 1: Failing tests** — a fake fetch answering 529 twice then 200 → `askJev` resolves with the 200 body and the fake sleep saw `[2000, 5000]`; 529 four times → throws with the last error text; 400 once → throws at once (no retry); `TypeError: fetch failed` twice then 200 → resolves.
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement** — `askJev(state, questions, { fetch: f = globalThis.fetch, sleep: s = defaultSleep } = {})`, loop over `[0, 2000, 5000, 10000]` delays.
- [ ] **Step 4: Run** — pass; `npm test` green. **Commit:** "Jev retries an overloaded or failed call three times with backoff before the breaker trips".

---

### Task 8: Confirmation pass (run by the controller, not a subagent)

**Spec:** "Confirmation".

- [ ] **Step 1:** `npm test` green on the final tree.
- [ ] **Step 2:** VPN on Norway, lid open. `LOCAL_HEADLESS=false node --env-file=.env src/scrape.mjs --concurrency 6 --force --ids "$(cat out/misses.txt)"` (the 719 misses), then the same for `out/sample150.txt` (150 random `ok/yes`).
- [ ] **Step 3:** Tally (scratchpad `tally.cjs` shape): misses → how many now `ok/yes`, how many per new status, remaining `ok/no` with their last rejection; sample → every id still `ok/yes`, list any whose URL changed, and any whose new URL names a promotion/product (must be none). Check sbotop by hand.
- [ ] **Step 4:** Any remaining `ok/no` that is not `(wall)` and not a `lobby:gambling_site` with no terms link: probe it, find the generic cause, fix, add a test, rerun those ids. Repeat until the pass is clean or the remaining misses are explained in the final report.
- [ ] **Step 5:** `node src/merge.mjs`, `node src/retry-ids.mjs out/results.csv`; `README.md` status table checked; commit "Confirmation pass: …" with the tallies in the message.
