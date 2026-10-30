# Local-first scrape, hidden terms text, and Jev as the terms judge

Date: 2026-10-29. Status: approved in discussion, awaiting review of this document.

## Why

The first full run (718 casinos so far) reached 620 casinos and found terms on 504. The 116 reached casinos without
terms split into:

| Failure | Casinos | Cause, verified on 2026-10-29 |
|---|---|---|
| Link found, page "not terms-like" | 64 | SoftSwiss `/rules` pages are accordions. `innerText` shows ~1,000 chars of section headings; the full terms (133k–280k chars) are in the DOM, hidden by CSS, and `textContent` returns them. The section expander matches `aria-expanded`/`accordion` markup this template does not use. |
| No terms link on the lobby | 29 | ~6 are parked domains, a cookie wall or a Cloudflare challenge. Others have the link in plain sight but off-domain: betico.pro's footer "Terms of Service" is a PDF on CloudFront, and `termsScore` rejects any host outside the casino's own domain. |
| Terms page walled | 7 | Bot wall on the terms page from every exit. |
| Terms page thin / PDF | 6 | PDFs (dexsport, americanluck) read as empty in the browser. |
| Clicked promo caption, nothing opened | 7 | "T&Cs apply", "Conditions:" scored as clickable terms text. |
| Load errors | 3 | |

Separately, the run costs Browserless units: 2,608 MB of metered proxy traffic for 718 casinos (3.6 MB each, ~27 GB
for the full set), plus the ten-minute session cap, 429 concurrency ceiling and casino timeouts the scraper works
around. 427 of the 620 reached casinos got in through the first exit tried; only ~130 needed another country.

**Result (2026-10-30, local headed Chrome through the Oslo exit, Jev on).** Of the 116 reached-without-terms casinos,
93 now have their general terms (Jev picks 75, of them 55 read from hidden text; guessed paths and sitemap 8; PDFs 7,
one through a second hop; a Zendesk section hop, a router-link click and a policy-hub tab one each), 6 turned out not
to be casinos (parked or for sale, Dan.com listings, review sites), 1 is under maintenance, 11 are not reachable from
this exit (blocked, geo-blocked, empty, DNS) and go to the Browserless pass, and 5 are left for a decision: the terms
are not published (epicjack.com), not linked anywhere on the lobby from this exit (betportal.com), behind app
deep links that redirect home (virginbet.co.za), behind a link that redirects to the lobby from this exit
(wandando.com), or split into one page per section (starzbet.com). The 30-casino regression sample: every one reached
has its terms (22) except one whose terms page is now walled from this exit (rapter6.com); 7 are blocked from this
exit. No challenge pages in any run.

## Decisions

1. **Local first, Browserless for the rest.** The full set is scraped from the user's Mac through a local Chrome
   with the HMA VPN set to Norway. Casinos that fail locally (not reached, or reached without terms) are re-run
   through Browserless on GitHub Actions with `only_ids`, exactly as today, and the two result sets are merged.
   The HMA VPN has no CLI, so the local phase uses one country.
2. **Read hidden text and PDFs** deterministically. No AI is needed for the 64 accordion pages or the PDF terms.
3. **Jev (TypeSafe AI) makes two judgments**: which footer entry is the general terms link, and whether a page is the
   general terms. Code decides what to do with the answers. Text questions only; footer screenshots with Box stay
   out (TypeSafe marks image questions as preview, and the text path covers every case seen).
4. **Fail open to today's behaviour.** No `TYPESAFE_API_KEY`, or an API error, means the terms search runs as it does
   now. Jev adds candidates and acceptances; it never removes them.
5. **The bar is 100% of reachable casinos.** A casino the scraper can open must come back with its terms. After the
   change, a row with `status = ok` and `terms_found = no` is a defect: it is probed, the cause is classified and
   fixed generically where possible, and the run is repeated until every remaining miss is one of: the terms page
   is bot-walled from this exit (`(wall)` in `terms_tried`, handed to the Browserless pass), or the page reached is
   not a casino at all (parked or for-sale domains get their own status, `parked`, so they no longer count as
   reached). Casino-specific oddities that resist a generic rule are listed for the user with the probe output.
   The same bar applies to the Browserless pass. To give the loop fewer misses to start from, the search also
   gains breadth: cookie banners are dismissed before the lobby is read, the guessed paths grow from 6 to 12 with
   a three-minute budget, and sitemap indexes are followed.

## 1. Local phase

`PROXY_PLAN` gains a phase type `local`, e.g. `PROXY_PLAN=local:no`. The country is a label for the result rows
and the VPN guard, not a proxy setting.

- `connect(country, type)` launches `chromium.launch({ channel: "chrome", headless: LOCAL_HEADLESS })` for
  `type === "local"` (the installed Google Chrome; `playwright-core` bundles no browser). Everything after the
  connect, `attempt()` included, is unchanged: the CDP blocklist and byte meter work on a local Chromium too.
  `LOCAL_HEADLESS` defaults to `true`; the pilot decides whether headed Chrome draws fewer challenge pages.
- `resolveDirect()` (tracker redirects) runs through the same local browser when the plan has a local phase.
- **Exit check, for information only.** Before the first casino, the shard asks ipinfo.io where this machine
  leaves from (Node's fetch, through the same VPN as the local Chrome) and prints the IP and country. Every reached
  casino records `ip` and `ip_country` from that answer, asked again once ten minutes have passed (one request in
  flight at a time; a failed lookup keeps the last good answer), so a VPN drop shows in the results within ten
  minutes without spending ipinfo.io's ~1,000-a-day free quota on a call per casino; Browserless sessions are still
  asked per session. The run does not stop for it (the user is fine with the home IP being used).
- Concurrency defaults to 6 for a local run (`--concurrency`). `CASINO_BUDGET` (20 min) and the per-session
  timeouts stay. `exit_country` records `local-no` style tags so local and Browserless rows are distinguishable.
- Keys live in `.env` (gitignored): `BROWSERLESS_TOKEN`, `TYPESAFE_API_KEY`, `PROXY_PLAN=local:no`. Scripts are run
  with `node --env-file=.env …` (Node 22.13+, `engines` in package.json; the Mac has Node 26). `BROWSERLESS_TOKEN` is not required for a local-only
  plan.

Running the whole set locally:

```
node src/jobs.mjs
node --env-file=.env src/scrape.mjs --concurrency 6
node src/merge.mjs
```

### Fallback through Browserless

- `src/retry-ids.mjs <results.csv>` writes `input/retry-ids.txt`: the ids whose `status` is not `ok` (`no_url`
  and `parked` excepted: there is nothing to retry), or whose `terms_found` is `no`, one per line, and prints the
  count by status. Dead sites are included; Browserless settles them cheaply, since a blocked attempt costs seconds.
- The scrape workflow's `only_ids` input also accepts `@input/retry-ids.txt`, read from the checked-out repo, so a
  thousand ids need not fit in a dispatch input. The file is committed before dispatching.
- Merging: the local `out/results.csv` is copied to `out/final/shard-previous.csv`, the Actions `results.csv`
  artifact to `out/final/shard-0.csv`, and `node src/merge.mjs out/final` produces the final `results.csv` and
  `results-by-row.csv`. `merge.mjs` already lets a later row replace the earlier attempt and only the retried ids
  come back from Actions, so local successes are never overwritten. The README documents this sequence.

## 2. Hidden text and PDFs

- **Hidden text.** `readDoc()` reads `innerText` as now. When the result fails `want` (too short, or not terms-like)
  the page is also read with a new in-page `hiddenText()`: the `textContent` of `document.body` with `script`,
  `style`, `noscript`, `template`, `svg`, `header`, `nav` and `footer` subtrees removed, block elements separated
  by newlines, whitespace collapsed. It is used when it is at least 2,000 characters and at least three times the
  `innerText` length; the document label gets ` (hidden text)`. Tested against the live SoftSwiss `/rules` pages
  (crusado-e.com, spinit2.com) and with a local fixture page in the test suite.
- **PDF terms.** A candidate whose href ends in `.pdf`, or whose navigation response has `content-type:
  application/pdf`, is fetched inside the page (`fetch(url)` → `arrayBuffer` → base64, through whatever route the
  session uses: VPN locally, the proxy on Browserless) and its text extracted in Node with `pdfjs-dist` (legacy
  build), capped at 250,000 characters. The document label gets ` (pdf)`. A PDF over 20 MB or that fails to parse is
  recorded in `terms_tried` as `(pdf unreadable)`.
- **Off-domain terms links.** `termsScore` keeps rejecting other hosts in general (a regulator's `/terms` must not
  win), but allows a footer link whose text matches `TERMS_TEXT` when the href is a PDF or on a known file host
  (`cloudfront.net`, `amazonaws.com`, `storage.googleapis.com`, `blob.core.windows.net`, a `cdn.`, `static.`,
  `files.`, `assets.` or `docs.` subdomain), at a 3-point penalty. Jev's choice (below) sees every footer link regardless, so other off-domain
  cases are covered there.

## 3. Jev

All question wording, option naming, thresholds and the HTTP call live in `src/jev.mjs`. Nothing else in the code
knows the API.

- **Call.** `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $TYPESAFE_API_KEY`, model pinned
  to `jev-1.14.0`, JSON body `{ model, state, questions }`. Plain `fetch`, 20 s timeout, one retry on 429 honouring
  `retry-after`, no SDK dependency. Returns `null` when the key is absent; throws on any other failure, which the
  callers catch and record as `jev: error` without changing the search. Both calls are made once per lobby and
  once per candidate page respectively; at ~2,000 input tokens each and $0.042 per million, the full set costs
  under a dollar.

- **Footer link choice** (`termsLinkQuestions(entries)`), asked once per lobby after `readLobby()`:
  - State: `{ links: [{ id, text, href, in_footer }] }`: every footer anchor, every clickable text, and any other
    anchor whose text or path matches the terms patterns; de-duplicated by href; at most 60 entries, footer first.
    Off-domain hrefs are included.
  - Questions: a Choice "Which entry in `links` is the link to the casino's general terms and conditions?" whose
    options are the entry ids, named `<slug of the link text>_<n>` (names are sent to the model; positional names
    bias it), each criterion holding the entry's text and URL path; and a Noul "Does `links` contain a link to the
    casino's general terms and conditions?" with `true`: "an entry whose text or URL means the general terms,
    terms of service, terms of use or user agreement of the casino itself", `false`: "only privacy, cookie,
    responsible-gambling, bonus or promotion terms, sports or game rules, 'T&Cs apply' captions, or no legal links
    at all".
  - Code: when the Noul is ≥ 0.7, the options with probability ≥ 0.2, best first, at most two, are placed ahead of
    the heuristic candidates (duplicates removed). A Jev-picked candidate that is a clickable text goes through
    the existing click path. The `pages` label records `(via jev)`; the heuristic order is otherwise untouched, so
    the 504 casinos that work today keep working.

- **Page judgment** (`termsPageQuestion(page)`), used wherever `readsLikeTerms` is tested today (link candidates,
  clicks, guessed paths):
  - The regex `readsLikeTerms` stays as the fast accept. When it fails on a page of at least 1,500 characters that
    is not a bot wall, Jev is asked a Noul "Is `page` the general terms and conditions of an online casino or
    sportsbook?" with `false`: "a promotion's or bonus terms, a privacy or cookie policy, game or sports-betting
    rules, a help centre, a lobby, or an error page". State: `{ page: { title, headings (≤ 30), text (first 6,000
    chars) } }`. Accept at ≥ 0.7. One call per distinct URL and text length per casino.

- **Result columns.** A new `jev` column: `link:<noul>/<p of pick>` and `page:<noul>` when consulted, `off` when
  no key, `error:<message>` on failure. Everything else stays as it is.

## 4. Testing and acceptance

- `tests/links.test.mjs`: off-domain PDF footer link qualifies (betico), regulator `/terms` still does not.
- `tests/jev.test.mjs`: state building and option naming from a sample footer, ordering with a fake answer set
  (confident pick goes first; low Noul changes nothing; null/throw leaves the heuristic order), page-judgment
  thresholds.
- `tests/doctext.test.mjs`: `hiddenText()` on a fixture page with a CSS-hidden accordion, run in the local Chrome.
- `src/probe-jev.mjs <url>`: opens a lobby in the local Chrome, prints the heuristic candidates, Jev's state and
  answers, follows the pick and prints the page judgment. Run against the failing casinos before anything is wired
  in: crusado-e.com, spinit.com, betico.pro, ab.betrivers.ca, megafrenzy.com, clubscasino.com, dexsport.io.
- Acceptance: a local run over the 116 failing ids (`node --env-file=.env src/scrape.mjs --ids …`), then a
  report. Target: every row that is `ok` has `terms_found = yes`, or its `terms_tried` ends in `(wall)`; every
  other miss is probed and fixed or, when only a casino-specific rule would fix it, listed for the user. No
  regression on a 30-casino sample of previously successful ids.
- Pilot of the local phase: 50 casinos with `--concurrency 6`, headless, checking challenge-page rate and
  `ip_country` before the full set.

## Out of scope

Footer screenshots and Box questions; rotating VPN countries; replacing the quote extraction in `extract.mjs`;
reading terms behind a login.
