# Full-run misses: fix wave 2 — design

**Date:** 2026-10-31
**Follows:** `2026-10-29-local-first-scrape-and-jev-terms-design.md` (the local-first scrape with Jev as the terms judge)
**Bar (unchanged):** if the scraper can reach a casino, it stores the casino's general terms and conditions; it never stores a promotion's, bonus, product-section or policy page as the general terms. A reached casino without terms is a defect unless the terms page is bot-walled or the site publishes no terms.

## What the full run showed

The full local run of 2026-10-30 (7,502 casinos, headed Chrome, Oslo exit, concurrency 6) reached 4,195 casinos and stored terms for 3,476. The 719 reached-without-terms rows split, by what `terms_tried` records, into:

| Class | Rows | What the probes found |
|---|---|---|
| No terms link or clickable found on the lobby | 478 | 74 are geo or regulatory notices in English, Portuguese or Russian that `BLOCK_TEXT` does not know; 13 say the site has closed; 3 are WAF/edge error pages; 3 are a domain marketplace's error page; a Jev entry list that only admits links matching an English-heavy regex, so Serbian, Turkish, Arabic, Thai and CJK terms links never reach Jev; the rest are sites with no terms link in any language (Asian e-wallet lobbies, Turkish redirect pages), affiliate or review sites, or placeholder templates — not casinos, or casinos that publish no terms |
| A page opened and was judged not the terms | 100 | Jev's page answer landed between 0.5 and 0.7 for real general terms (rushgames 0.69, wonderlandcasino 0.69, napoleongames 0.79→0.91 on core text); bonus or product terms were rightly rejected (0.02–0.43) but the general terms next to them were not looked for; some sites are affiliates (legolas.bet) |
| A click opened nothing | 45 | The click opened a new tab (wildcasino.ag → help.wildcasino.ag, 12,000 chars) or a modal whose text sits in an iframe (slotmagie.de, rocket.run); neither is read |
| A page was the lobby shell | 25 | europacasino: a "closed for business" page; mad.casino: a Russian geo notice; campobet: the terms are 285,000 characters of collapsed sections, hidden, under a visible shell; pokerstars: the terms render late and the snapshot was the shell |
| A page was too thin | 25 | promo landing pages and app shells |
| The terms page is bot-walled | 16 | acceptable misses, already marked `(wall)` |
| Jev unavailable (HTTP 529, system overloaded) | 115 rows (24 misses, 91 regex-only accepts) between 19:59 and 20:47 | one outage, no retry, no backoff |

One stored false positive was found: sbotop.com's voucher terms, reached through the last-resort path that tries links the heuristic scores at 0 or below.

## Design

Seven changes, each generic (no casino-specific rule), each with a test.

### 1. Lobby classification: new terminal statuses and a Jev lobby judgment

`lobbyStatus()` gains two statuses and broader detection:

- **`closed`** — the site says it has ceased: "closed for business", "no longer available/operating/accepting", "has been discontinued", "ceased operations", and the equivalents in the languages below. Counted like `parked`: terminal, not retried.
- **`not_casino`** — the page is not an online gambling operator's site: an affiliate or review site, a news site, a blog, a placeholder template, a software vendor's page. Decided by Jev only (below).
- **`geo_blocked`** — `BLOCK_TEXT` learns the forms seen: "(not|no longer) (being )?(available|offered|accessible)[^.]{0,80}(your|this) (location|country|region|jurisdiction)", "residing in your (country|location|jurisdiction)", "unavailable in your location", "not available in your country", Portuguese "acesso bloqueado", "medida provisória", "fora do ar por determinação", Russian "ограничение местоположения", "не можем принять игроков", Spanish "no está disponible en (tu|su) (país|región)", German "in Ihrem Land nicht verfügbar", French "pas disponible dans votre pays", Italian "non disponibile nel tuo paese", Turkish "ülkenizde kullanılamıyor". Checked in the first 5,000 characters, as today.
- **`blocked_http`** — also when the lobby text is an edge or WAF refusal: "Access Denied", "Request (was )?(blocked|rejected)", "Reference #<digits>", "Incident ID", "errors.edgesuite.net", Slovak/Czech "zamietnutá"/"zamítnuta" with "URL". And when the final host is a marketplace host (`forsale.godaddy.com`, `sedo.com`, `dan.com`, `afternic.com`, `hugedomains.com`) the status is `parked` whatever the page says (an error page from the marketplace is still a parked domain).

**Jev lobby judgment.** When the lobby yields no terms candidate and no terms clickable (the "no terms link or text on the lobby" case), and the regex classification says `ok`, Jev is asked one Choice question about the lobby (URL, title, first 3,000 characters of visible text, the footer's link captions): *what is this page?* with the options `gambling_site` (an online casino, sportsbook, poker, bingo or lottery operator's own site, whatever its language), `geo_or_regulatory_notice`, `closed_or_suspended`, `parked_or_for_sale`, `not_gambling_site` (an affiliate, review, comparison or news site, a blog, a template or placeholder, a software vendor), `error_or_bot_wall`. The status follows the top option when its probability is ≥ 0.8 and the question's Noul is ≥ 0.7: `geo_blocked`, `closed`, `parked`, `not_casino`, `blocked_http`; `gambling_site` or an unsure answer leaves `ok`. The answer is noted in the `jev` column as `lobby:<option>:<p>`. Fail open: without a key or on failure the regex result stands.

`merge.mjs` ranks `closed` and `not_casino` with `parked`, at the same rank as `ok` without terms (all four say "reached and classified"; between equals the later row wins): `ok+yes > ok+no = parked = closed = not_casino > reached-but-blocked > not reached`. `retry-ids.mjs` excludes `parked`, `closed`, `not_casino`. `report.mjs` lists them under "not a casino / not operating".

### 2. Jev sees every footer link

`linkEntries(lobby)` admits, in this order and up to 60 entries: every footer link with a caption (any language, any script), every clickable text, then non-footer links matching `LEGAL`. The `LEGAL` filter stays only for non-footer links. Captions are clipped to 60 characters as today; links with an empty caption and a non-legal path are still skipped. Image-only links keep their `aria-label` or `title` as caption (readLobby already reads `aria-label`; add `title` and the image's `alt`).

`TERMS_TEXT` (candidate scoring), `LEGAL` (Jev entry filter), `TERMS_WORDS` (the page gate's word count) and `CLICK_TEXT` learn the terms words of: Dutch (voorwaarden), Italian (termini, condizioni), Spanish (términos), Serbian/Croatian/Bosnian/Slovenian (pravila, uslovi, uvjeti, pogoji, opšti/opći uslovi), Czech/Slovak (podmínky, podmienky), Romanian (termeni), Hungarian (feltételek, szabályzat), Greek (όροι), Turkish (şartlar, kurallar, koşullar), Arabic (الشروط, الأحكام), Hebrew (תנאים), Thai (ข้อกำหนด, เงื่อนไข), Japanese (利用規約), Chinese (条款, 條款, 规则, 規則), Korean (이용약관, 약관), Indonesian/Malay (syarat, ketentuan, terma), Vietnamese (điều khoản), Latvian (noteikumi), Lithuanian (taisyklės), Estonian (tingimused), Ukrainian (умови). Word boundaries: `\b` does not work for non-Latin scripts; those words match as substrings. `readsLikeTerms` keeps its thresholds (2,000 characters, 5 words).

### 3. A click that opens a new tab or an iframe

`clickOpen`:

- Listens for a `page` event on the browser context from just before the click until 8 seconds after it. A new page is the document: it is read with `readDoc` (35 s, `readsLikeTerms`), judged with `isTermsPage` as a navigated page (its own URL is `meta.url`), stored with `href` = its URL and `via: "click"`, and closed afterwards whatever the outcome. The lobby page is not touched.
- When no navigation and no popup happened and the visible text did not grow by 2,000 characters, it looks for an iframe that the click made visible or that holds a document: every frame other than the main one whose `body.innerText` is ≥ 1,500 characters (Playwright evaluates in cross-origin frames). The longest such text is the document, judged with `isTermsPage` as an in-place open (`fastInPlace`), `href` = the frame's URL when it has one, else `${at}#"<click text>"`.

`readDoc` (navigated pages) gets the same frame fallback: when the visible body text stays under 500 characters or fails `want`, and a frame holds ≥ 1,500 characters that pass `want`, the frame text is the document (`frame: true`). A PDF viewer frame is not read this way (its URL ends in `.pdf` or the frame's content type is PDF): `tryPdf` already handles PDFs.

### 4. A shell that hides or delays the document

In `tryLink`, `readDoc`'s `want` becomes `(t) => readsLikeTerms(t) && !isShellOf(t, lobbyRef, lobbyText)`: a snapshot that is still the shell keeps polling until the budget, so a late-rendering document (pokerstars) is read once it arrives.

When the budget ends on a shell: (a) `expandSections(page)` once, then one more read; (b) the hidden text is read; if it is not the lobby's hidden shell (`!isShellOf(h, lobbyHidden, lobbyHiddenText)`) and reads like terms, it is judged with `isTermsPage` (hidden: true) and accepted on that basis (campobet's 285,000 hidden characters). Only then does the current shell path run (unblocked retry, hop).

### 5. Jev's page judgment reads the document, not the chrome

`isTermsPage` sends Jev `coreText(text, lobbyText)` when that is ≥ 1,500 characters, else the full text. `state.page` also carries `core: true|false`.

Borderline band: when `is_terms.noul` is in `[0.5, 0.7)`, a second Noul question is asked about the same page: *is `page` a promotion's or bonus terms, one product section's terms, a policy, game or betting rules, or anything other than the general terms of the whole site?* The page is accepted when that answer's noul ≤ 0.3 **and** `readsLikeTerms(doc)`. Both answers are noted (`page:0.65 excl:0.12`). Below 0.5 the page is rejected as today. `PAGE_NOUL_MIN` stays 0.7 for the single-question accept.

### 6. Low-scored links are Jev's alone; the general terms next to a bonus page are looked for

- The last-resort pass over candidates scored ≤ 0 runs only while Jev is up and judges with `{ fast: false, jevOnly: true }`: the regex never accepts those pages. Its `via` becomes `"low-score link"`. With Jev down the pass is skipped.
- When a candidate page was rejected and its URL names a promotion or product (`PROMO` or `PRODUCT` in its path, or the page's first heading), `siblingGuesses` is fed that URL: the segment with the promo/product word removed (`/en/terms/bonus/` → `/en/terms/`), replaced by each of `SIBLING_NAMES` (`/help/bonus-terms-and-conditions` → `/help/terms-and-conditions`, `/help/terms`), and the parent directory. These guesses run before the common paths and inside the 3-minute budget; they are judged like other guesses (not shell, `isTermsPage`).

### 7. Jev outages: retry, and mark for rerun

`askJev` retries HTTP 429, 5xx and 529 (system overloaded) with backoff 2 s, 5 s, 10 s before throwing; a network failure (`fetch failed`) gets the same three tries. The per-casino circuit breaker (`jevDown`) trips only after the retries fail. `retry-ids.mjs` adds a third group: `ok` rows whose `jev` column contains `error:` (Jev did not judge them), listed with reason `jev-failed`, whether or not terms were found.

## Confirmation

1. Unit tests for each change (fixtures: a lobby with a Serbian "Uslovi korišćenja" footer link, a click that opens a popup page, a click that fills an iframe, a shell that fills after 4 s, a shell over 50,000 hidden characters, a closed-for-business lobby, a Russian geo notice, a marketplace error page, a Jev 529 then 200, a borderline page with a low exclusion answer, a bonus-terms URL yielding sibling guesses). `npm test` green.
2. Forced local rerun of the 719 misses (`out/misses-719.txt`) and of the 115 Jev-outage ids. Target: no `(lobby shell)` on a page that is the terms; no `click … (nothing opened)` where the click opens a tab or iframe; every remaining `ok/no` is a `(wall)`, a `gambling_site` with no terms link in any language (Jev's lobby answer recorded), or explained; the new statuses applied where the probes said so (europacasino `closed`, 888/mrgreen/mad.casino `geo_blocked`, fikacasino/legolas/slotsoasis `not_casino`).
3. Regression sample: 150 random `ok/yes` ids from the full run rerun with `--force`; every one stays `ok/yes` with the same or a better-scored URL; 20 of them spot-checked by hand against the live site, plus sbotop (must no longer store the voucher terms).
4. Full-run merge rebuilt (`node src/merge.mjs`), `retry-ids` regenerated, README and report updated for the new statuses.

## Out of scope

Casino-specific rules; Browserless changes beyond what the shared code brings; the 3,118 not-reached casinos (they go to Browserless as planned).
