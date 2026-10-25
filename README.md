# Casino terms scrape

Visits every casino listed by CasinoGuru, AskGamblers and LCB.org (one job per CSV row, duplicates kept), through the
review site's tracking link where there is one, and records what the casino's footer and terms say about its licence,
owner, withdrawals, installments, KYC and restricted countries, plus where the scraper got in from. Raw quotes, not
clean values: a reviewer reads the casino's own wording.

Runs on GitHub Actions through Browserless, so nothing depends on anyone's PC.

## Running it

1. Repository settings → Secrets → `BROWSERLESS_TOKEN` (your Browserless API key). Optional variables:
   `BROWSERLESS_REGION` (default `production-sfo`), `EXIT_COUNTRIES` (default `ca,de,br,nz`).
2. Actions → **Scrape casino terms** → Run workflow.
   - `limit_per_source`: rows per CSV, `0` for everything. A pilot is `10`.
   - `shards`: parallel jobs. A job must finish inside 6 hours; budget about a minute per row per worker.
   - `concurrency`: browser sessions per job. `shards × concurrency` must stay under the Browserless plan's concurrent-session limit.
   - `only_ids`: re-run specific rows (ids from the results, e.g. `casinoguru-00017`).
3. When it finishes, download the **results** artifact: `results.csv`. Each `shard-N` artifact also holds the full
   page text per casino (`text/<id>.txt`) for anything the quote patterns missed.

## What a result row holds

| Column | Meaning |
|---|---|
| `id`, `source`, `casino`, `review_url` | the input row |
| `start_type`, `start_url` | `tracking` link, or the casino `domain` when the link was N/A |
| `status` | `ok`, `geo_blocked` (the page says so), `blocked_http` (bare 403/451), `challenge` (bot check), `stuck_on_tracker`, `dead_or_empty`, `load_error`, `connect_error`, `no_url` |
| `final_url`, `final_domain`, `redirect_chain` | where the tracking link landed |
| `exit_country`, `ip`, `ip_country`, `countries_tried` | the proxy country that got in (`direct` = Browserless's own egress), the IP the sites saw, everything tried |
| `scraped_at` | UTC timestamp |
| `pages` | which pages were read: footer, terms, payments, KYC/AML |
| `licence_numbers`, `jurisdictions` | pattern-matched from the text |
| `q_licence`, `q_owner`, `q_withdrawal_limits`, `q_withdrawal_time`, `q_installments`, `q_kyc`, `q_restricted` | raw quotes, one per line, each ending with ‹the page it came from› |
| `footer` | the landing page's footer text |
| `error` | the HTTP status or error for failed rows |

## How it reads a casino

1. Open the tracking link through a residential proxy, Canada first, then the other `EXIT_COUNTRIES` if the casino
   blocks it. The residential proxy refuses the tracker domains, so the redirect is resolved without a proxy first
   and the destination is then opened through the proxy. Casinos the proxy also refuses get one direct attempt.
2. Record the final URL, the redirect chain, and the IP and country reported by ipinfo.io for that session.
3. Read the footer, then follow the page's own links to terms and conditions, payments and KYC/AML pages.
4. Pull every sentence matching the keyword rules in `src/extract.mjs`.

## Locally

```
npm install
node src/jobs.mjs --limit-per-source 2
BROWSERLESS_TOKEN=... node src/scrape.mjs --concurrency 2
node src/merge.mjs
```

Results land in `out/`. A re-run skips rows already in the shard's CSV.
