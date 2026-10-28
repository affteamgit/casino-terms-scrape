# Casino terms scrape

Visits every casino listed by CasinoGuru, AskGamblers and LCB.org, through the review site's tracking link where
there is one, and records what the casino's footer and terms say about its licence, owner, withdrawals, installments,
KYC and restricted countries, plus where the scraper got in from. Raw quotes, not clean values: a reviewer reads the
casino's own wording.

A casino listed on two or three of the sites is visited once: the rows are grouped into casinos first (see
"Duplicates" below), and the merge step writes the casino's result back onto every one of its input rows.

Runs on GitHub Actions through Browserless, so nothing depends on anyone's PC.

## Duplicates

`input/casinos.json` and `input/row-groups.csv` hold the grouping the scrape runs from; rebuild them when the input
CSVs change:

1. Actions → **Resolve tracking links** → Run workflow. It follows every CasinoGuru and LCB link with plain HTTP (no
   Browserless units) and records the casino domain each lands on; AskGamblers' CSV already carries the domain.
   casino.guru refuses an IP after a few hundred requests, so the links are spread over many runners and a shard stops
   when it is refused; re-run to pick up the remainder. Download the **resolved** artifact to `input/resolved.json`.
2. `node src/dedupe.mjs` groups the rows by domain (functional subdomains such as `go.`, `promo.` or `casino.`
   stripped). Variant domains of one brand (an affiliate prefix, a mirror digit, another TLD, the casino's own
   tracker) join it only when they also share a casino name, so `slots52.com` stays apart from `slots.com`. A host
   that unrelated casinos land on (an affiliate hub, a block page, a casino that closed brands redirect to) is not a
   key: those rows keep their own tracking link and are grouped by name, as are rows whose link did not resolve.
   Copy `out/casinos.json` and `out/row-groups.csv` into `input/`.

Each casino's job starts from its CasinoGuru link, else AskGamblers, else LCB, else the bare domain.

## Running it

1. Repository settings → Secrets → `BROWSERLESS_SECRET` (your Browserless API key). Optional variables:
   `BROWSERLESS_REGION` (default `production-sfo`), `EXIT_COUNTRIES` (default `ca,de,nz,fi,ie,br,jp,in`; every
   country is tried on a bare 403/451, since a casino that refuses Canada and Germany may serve New Zealand; only a
   bot-check page from two countries stops the rotation), `PROXY_PLAN` (default
   `datacenter:ca,de;residential:<EXIT_COUNTRIES>`: the datacenter proxy first, at 2 units per MB, then the
   residential proxy, at 6, for casinos that block hosting IPs).
2. Actions → **Scrape casino terms** → Run workflow.
   - `limit_per_source`: casinos per source site, `0` for everything. A pilot is `10`.
   - `shards`: parallel jobs. A job must finish inside 6 hours; budget about a minute per casino per worker.
   - `concurrency`: browser sessions per job. `shards × concurrency` must stay under the Browserless plan's concurrent-session limit.
   - `only_ids`: re-run specific casinos (ids from the results, e.g. `casinoguru-00017`).
   - `previous_run_id`: continue a run. A job starts no new casino after 320 minutes (GitHub stops jobs at 6
     hours); dispatch again with the first run's id and the casinos it finished are skipped and carried into the
     new results.
3. When it finishes, download the **results** artifact: `results.csv` has one row per casino, `results-by-row.csv`
   one row per input row (each CasinoGuru / AskGamblers / LCB listing with its review URL and its casino's data).
   Each `shard-N` artifact also holds the full page text per casino (`text/<id>.txt`) for anything the quote
   patterns missed.

## What a result row holds

| Column | Meaning |
|---|---|
| `id`, `source`, `casino`, `review_url` | the casino (id = the input row its job started from; `source` lists every site it appears on, e.g. `casinoguru+lcb`) |
| `start_type`, `start_url` | `tracking` link, or the casino `domain` when the link was N/A |
| `status` | `ok`, `geo_blocked` (the page says so), `blocked_http` (bare 403/451), `challenge` (bot check), `stuck_on_tracker`, `dead_or_empty`, `load_error`, `connect_error`, `no_url` |
| `final_url`, `final_domain`, `redirect_chain` | where the tracking link landed |
| `exit_country`, `ip`, `ip_country`, `countries_tried` | the proxy country that got in (`dc-` prefix = datacenter proxy, `direct` = Browserless's own egress), the IP the sites saw, everything tried |
| `scraped_at` | UTC timestamp |
| `terms_found` | `yes` when a terms page was read; `no` means no terms link or clickable text on the lobby, or every candidate was thin, still loading or a bot wall |
| `terms_tried` | the terms candidates that failed, with the reason, for rows with `terms_found = no` |
| `mb` | megabytes moved through the proxy for this casino, across all its sessions (Browserless bills 6 units per residential MB) |
| `pages` | which pages were read: footer, terms, payments, KYC/AML |
| `licence_numbers`, `jurisdictions` | pattern-matched from the text |
| `q_licence`, `q_owner`, `q_withdrawal_limits`, `q_withdrawal_time`, `q_installments`, `q_kyc`, `q_restricted` | raw quotes, one per line, each ending with ‹the page it came from› |
| `footer` | the landing page's footer text |
| `error` | the HTTP status or error for failed rows |

## How it reads a casino

1. Open the tracking link through the datacenter proxy, Canada then Germany, and if the casino blocks hosting IPs
   through the residential proxy, Canada first, then the other `EXIT_COUNTRIES`. The proxies refuse the tracker
   domains, so the redirect is resolved without a proxy first and the destination is then opened through the proxy.
   Casinos the proxy also refuses get one direct attempt. `exit_country` carries a `dc-` prefix for a datacenter exit.
2. Record the final URL, the redirect chain, and the IP and country reported by ipinfo.io for that session.
3. Wait for the lobby to finish rendering (single-page apps draw the footer late), then read the footer.
4. Open the terms. Casinos always have them, so the search escalates until something is found: every anchor is
   scored (`src/links.mjs`) and up to three general-terms candidates are tried; where the footer routes from plain
   elements instead of anchors (Lebull) the element that reads like the terms link is clicked; the registration
   page is scanned, since it always links the terms a player accepts (PlayGrand); the sitemap and the paths
   casinos commonly use are opened in the browser (Rokubet); and only then a promotion's terms page is taken. A
   page that only asks for a country (unibet.com) is followed to the brand's regional site first. A document counts
   only once its text has stopped growing, is not a bot wall or a font placeholder, and reads like terms (a
   help-centre home page does not). The `pages` column says how the terms were reached
   (`via click`, `via signup-page`, `via guess`, `via promo-terms`), and `terms_tried` what failed. A lobby reached
   without its terms (a bot wall on the terms page through that exit) is kept only as a fallback while the other
   exit countries are tried.
5. Follow the page's own links to payments and KYC/AML pages the same way.
6. Pull every sentence matching the keyword rules in `src/extract.mjs`.

## Locally

```
npm install
node src/jobs.mjs --limit-per-source 2
BROWSERLESS_TOKEN=... node src/scrape.mjs --concurrency 2
node src/merge.mjs
```

Results land in `out/`. A re-run skips rows already in the shard's CSV.
