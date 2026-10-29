// Renders a results.csv as a single HTML page for reading through a run: one row per casino with its status, where it
// was reached from, the licence patterns found, and every raw quote grouped by field with the page it came from.
// Usage: node src/report.mjs <results.csv> <out.html> [title]
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

const [, , input, output, title = "Scrape results"] = process.argv;
const rows = parse(readFileSync(input), { columns: true, skip_empty_lines: true });
const QUOTE_FIELDS = [["q_licence", "Licence"], ["q_owner", "Owner"], ["q_withdrawal_limits", "Withdrawal limits"], ["q_withdrawal_time", "Withdrawal time"], ["q_installments", "Installments"], ["q_kyc", "KYC"], ["q_restricted", "Restricted countries"]];

// "sentence ‹terms https://…›" per line -> { text, page, url }
const quotes = (s) => (s || "").split("\n").filter(Boolean).map((line) => {
  const m = line.match(/^(.*?)\s*‹(\S+)\s*([^›]*)›\s*$/);
  return m ? { text: m[1], page: m[2], url: m[3] } : { text: line, page: "", url: "" };
});
const data = rows.map((r) => ({
  id: r.id, source: r.source, casino: r.casino, review_url: r.review_url, start_type: r.start_type, start_url: r.start_url,
  status: r.status, final_url: r.final_url, final_domain: r.final_domain, chain: (r.redirect_chain || "").split(" > ").filter(Boolean),
  exit_country: r.exit_country, ip: r.ip, ip_country: r.ip_country, countries_tried: r.countries_tried, scraped_at: r.scraped_at,
  terms_found: r.terms_found, pages: (r.pages || "").split(" | ").filter(Boolean), licence_numbers: r.licence_numbers, jurisdictions: r.jurisdictions,
  quotes: Object.fromEntries(QUOTE_FIELDS.map(([k]) => [k, quotes(r[k])])), footer: (r.footer || "").slice(0, 600), error: r.error, terms_tried: r.terms_tried || "",
}));

const html = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: a summary strip, then one dense table of casinos; a row opens into its quotes beneath it. */
:root {
  --bg: #f6f4ef; --panel: #fffdf9; --fg: #1f2a24; --muted: #66706a; --line: #d9d4c8; --accent: #0f6e56;
  --ok: #1d7a4f; --ok-bg: #e2f2e8; --warn: #9a5b00; --warn-bg: #fbeed2; --bad: #a8323a; --bad-bg: #f9e1e2; --neutral-bg: #e9e6dd;
  --sans: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #15191b; --panel: #1c2124; --fg: #e6e3dc; --muted: #9aa39d; --line: #333b3f; --accent: #5cc8a6;
  --ok: #6fd39d; --ok-bg: #163b2a; --warn: #f0b860; --warn-bg: #3d2d10; --bad: #f28b92; --bad-bg: #4a1f23; --neutral-bg: #2a3135; color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #15191b; --panel: #1c2124; --fg: #e6e3dc; --muted: #9aa39d; --line: #333b3f; --accent: #5cc8a6;
  --ok: #6fd39d; --ok-bg: #163b2a; --warn: #f0b860; --warn-bg: #3d2d10; --bad: #f28b92; --bad-bg: #4a1f23; --neutral-bg: #2a3135; color-scheme: dark;
}
body { background: var(--bg); color: var(--fg); font-family: var(--sans); font-size: 14px; line-height: 1.45;
  padding-block: 28px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
main { max-width: 1240px; margin: 0 auto; display: grid; gap: 22px; }
h1 { font-size: 22px; font-weight: 600; margin: 0; text-wrap: balance; }
h1 small { font-weight: 400; color: var(--muted); font-size: 14px; margin-left: 10px; }
.lede { color: var(--muted); margin: 4px 0 0; max-width: 70ch; }
.strip { display: flex; flex-wrap: wrap; gap: 10px 28px; padding: 14px 18px; border: 1px solid var(--line); background: var(--panel); border-radius: 6px; }
.stat { display: grid; gap: 2px; }
.stat b { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat span { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.controls { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.controls input, .controls select { font: inherit; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 6px 9px; }
.controls input { min-width: 220px; }
.controls input:focus-visible, .controls select:focus-visible, .row:focus-visible, .q a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.hint { color: var(--muted); font-size: 12px; }
.wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; min-width: 980px; }
th, td { text-align: left; padding: 8px 10px; border-top: 1px solid var(--line); vertical-align: top; }
th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 500; border-top: 0; white-space: nowrap; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
th.num { text-align: right; }
.row { cursor: pointer; }
.row:hover td { background: color-mix(in srgb, var(--accent) 7%, transparent); }
.row.open td { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.mono { font-family: var(--mono); font-size: 12px; }
.id { color: var(--muted); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; white-space: nowrap; background: var(--neutral-bg); }
.pill.ok { background: var(--ok-bg); color: var(--ok); }
.pill.warn { background: var(--warn-bg); color: var(--warn); }
.pill.bad { background: var(--bad-bg); color: var(--bad); }
.dot { color: var(--muted); }
.count { display: inline-block; min-width: 1.6em; text-align: center; padding: 0 4px; border-radius: 3px; font-size: 12px; font-variant-numeric: tabular-nums; background: var(--neutral-bg); color: var(--muted); }
.count.has { background: var(--ok-bg); color: var(--ok); }
tr.detail td { background: var(--bg); padding: 16px 18px 20px; border-top: 1px dashed var(--line); }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px 24px; margin-bottom: 14px; }
.meta div { min-width: 0; }
.meta dt { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; }
.meta dd { margin: 2px 0 0; overflow-wrap: anywhere; }
.meta a { color: var(--accent); }
.fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; }
.field { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; min-width: 0; }
.field h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 500; display: flex; justify-content: space-between; gap: 8px; }
.field .none { color: var(--muted); font-style: italic; }
.q { margin: 0; padding: 6px 0; border-top: 1px solid var(--line); font-size: 13px; }
.q:first-of-type { border-top: 0; }
.q .src { display: inline-block; margin-left: 6px; font-family: var(--mono); font-size: 11px; color: var(--accent); text-decoration: none; white-space: nowrap; }
.footer-text { font-size: 12.5px; color: var(--muted); max-height: 3.2em; overflow: hidden; }
.chain { font-family: var(--mono); font-size: 11.5px; color: var(--muted); overflow-wrap: anywhere; }
@media (max-width: 640px) { body { font-size: 13px; } .controls input { min-width: 0; flex: 1 1 160px; } }
@media (prefers-reduced-motion: no-preference) { .row td { transition: background .12s; } }
</style>
<main>
  <header>
    <h1>${title}<small>${data.length} casinos</small></h1>
    <p class="lede">Each row is one casino the scraper visited. Open a row to read the raw quotes it pulled from the footer, terms, payments and KYC pages, each tagged with the page it came from.</p>
  </header>
  <section class="strip" id="strip"></section>
  <section class="controls">
    <input id="search" type="search" placeholder="Filter by casino, licence, jurisdiction…" aria-label="Filter rows">
    <select id="status" aria-label="Filter by status"><option value="">All statuses</option></select>
    <select id="terms" aria-label="Filter by terms found"><option value="">Terms found: any</option><option value="yes">Terms found</option><option value="no">No terms page</option></select>
    <span class="hint" id="shown"></span>
  </section>
  <div class="wrap"><table>
    <thead><tr><th>Casino</th><th>Status</th><th>Reached via</th><th>Terms</th><th>Licence numbers</th><th>Jurisdictions</th>${QUOTE_FIELDS.map(([, l]) => `<th class="num" title="${l} quotes">${l.replace("Withdrawal ", "W. ").replace("Restricted countries", "Restricted")}</th>`).join("")}</tr></thead>
    <tbody id="rows"></tbody>
  </table></div>
</main>
<script type="application/json" id="data">${JSON.stringify(data).replace(/<\//g, "<\\/")}</script>
<script>
const DATA = JSON.parse(document.getElementById("data").textContent);
const FIELDS = ${JSON.stringify(QUOTE_FIELDS)};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const CLASS = { ok: "ok", geo_blocked: "warn", blocked_http: "bad", challenge: "bad", stuck_on_tracker: "warn", dead_or_empty: "bad", maintenance: "warn", parked: "warn", load_error: "bad", connect_error: "bad", no_url: "bad" };
const LABEL = { ok: "ok", geo_blocked: "geo-blocked", blocked_http: "blocked (http)", challenge: "bot check", stuck_on_tracker: "stuck on tracker", dead_or_empty: "dead / empty", maintenance: "maintenance", parked: "parked", load_error: "load error", connect_error: "connect error", no_url: "no url" };

const strip = document.getElementById("strip");
const tally = (f) => DATA.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});
const st = tally((r) => r.status), ex = tally((r) => r.exit_country || "—");
const stats = [
  ["Casinos", DATA.length], ["Reached (ok)", st.ok || 0], ["Terms page read", DATA.filter((r) => r.terms_found === "yes").length],
  ["Licence number found", DATA.filter((r) => r.licence_numbers).length], ["Blocked / dead", DATA.length - (st.ok || 0)],
  ["Exit countries", Object.entries(ex).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + " " + n).join(" · ")],
];
strip.innerHTML = stats.map(([l, v]) => '<div class="stat"><b>' + esc(v) + "</b><span>" + esc(l) + "</span></div>").join("");

const statusSel = document.getElementById("status");
for (const s of Object.keys(st).sort()) statusSel.insertAdjacentHTML("beforeend", '<option value="' + esc(s) + '">' + esc(LABEL[s] || s) + " (" + st[s] + ")</option>");

const body = document.getElementById("rows");
const open = new Set();
function rowHtml(r) {
  const n = (k) => r.quotes[k].length;
  return '<tr class="row' + (open.has(r.id) ? " open" : "") + '" data-id="' + esc(r.id) + '" tabindex="0" role="button" aria-expanded="' + open.has(r.id) + '">' +
    "<td><div>" + esc(r.casino) + '</div><div class="mono id">' + esc(r.id) + " · " + esc(r.start_type) + "</div></td>" +
    '<td><span class="pill ' + (CLASS[r.status] || "") + '">' + esc(LABEL[r.status] || r.status) + "</span>" + (r.error && r.status !== "ok" ? '<div class="mono id">' + esc(r.error) + "</div>" : "") + "</td>" +
    '<td class="mono">' + (r.exit_country ? esc(r.exit_country) + ' <span class="dot">→</span> ' + esc(r.ip_country) : esc(r.ip_country || "—")) + (r.countries_tried && r.countries_tried !== r.exit_country ? '<div class="id">tried ' + esc(r.countries_tried) + "</div>" : "") + "</td>" +
    "<td>" + (r.terms_found === "yes" ? '<span class="pill ok">yes</span>' : r.status === "ok" ? '<span class="pill warn">no</span>' : '<span class="dot">—</span>') + "</td>" +
    '<td class="mono">' + (esc(r.licence_numbers) || '<span class="dot">—</span>') + "</td>" +
    "<td>" + (esc(r.jurisdictions) || '<span class="dot">—</span>') + "</td>" +
    FIELDS.map(([k]) => '<td class="num"><span class="count' + (n(k) ? " has" : "") + '">' + n(k) + "</span></td>").join("") +
    "</tr>" + (open.has(r.id) ? detailHtml(r) : "");
}
function detailHtml(r) {
  const link = (u, label) => u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(label || u) + "</a>" : "—";
  const meta = [
    ["Review page", link(r.review_url, r.source + " review")], ["Start URL", link(r.start_url)], ["Landed on", link(r.final_url, r.final_domain || r.final_url)],
    ["IP seen by the casino", r.ip ? esc(r.ip) + " (" + esc(r.ip_country) + ")" : "—"], ["Pages read", r.pages.length ? r.pages.map((p) => { const [kind, url] = p.split(" "); return url ? link(url, kind) : esc(kind); }).join(", ") : "—"],
    ["Scraped", esc((r.scraped_at || "").replace("T", " ").slice(0, 16) + " UTC")],
    ...(r.terms_tried ? [["Terms candidates that failed", esc(r.terms_tried)]] : []),
  ];
  return '<tr class="detail"><td colspan="' + (6 + FIELDS.length) + '">' +
    '<dl class="meta">' + meta.map(([k, v]) => "<div><dt>" + k + "</dt><dd>" + v + "</dd></div>").join("") + "</dl>" +
    (r.chain.length > 1 ? '<p class="chain">redirects: ' + r.chain.map(esc).join(" → ") + "</p>" : "") +
    '<div class="fields">' + FIELDS.map(([k, label]) => {
      const qs = r.quotes[k];
      return '<section class="field"><h3><span>' + label + "</span><span>" + qs.length + "</span></h3>" +
        (qs.length ? qs.map((q) => '<p class="q">' + esc(q.text) + (q.url ? '<a class="src" href="' + esc(q.url) + '" target="_blank" rel="noopener">‹' + esc(q.page) + "›</a>" : q.page ? '<span class="src">‹' + esc(q.page) + "›</span>" : "") + "</p>").join("") : '<p class="q none">no matching sentence</p>') +
        "</section>";
    }).join("") +
    (r.footer ? '<section class="field" style="margin-top:12px"><h3><span>Footer text (first 600 chars)</span></h3><p class="footer-text">' + esc(r.footer) + "</p></section>" : "") +
    "</div></td></tr>";
}
function render() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  const s = statusSel.value, t = document.getElementById("terms").value;
  const shown = DATA.filter((r) => (!s || r.status === s) && (!t || (t === "yes" ? r.terms_found === "yes" : r.terms_found !== "yes")) &&
    (!q || [r.casino, r.id, r.licence_numbers, r.jurisdictions, r.final_domain, r.exit_country].join(" ").toLowerCase().includes(q)));
  body.innerHTML = shown.map(rowHtml).join("");
  document.getElementById("shown").textContent = shown.length + " of " + DATA.length + " shown";
}
body.addEventListener("click", (e) => { const tr = e.target.closest("tr.row"); if (!tr || e.target.closest("a")) return; toggle(tr.dataset.id); });
body.addEventListener("keydown", (e) => { const tr = e.target.closest("tr.row"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(tr.dataset.id); } });
function toggle(id) { open.has(id) ? open.delete(id) : open.add(id); render(); }
for (const id of ["search", "status", "terms"]) document.getElementById(id).addEventListener("input", render);
render();
</script>
`;
writeFileSync(output, html);
console.log(`${data.length} rows -> ${output} (${(html.length / 1024).toFixed(0)} KB)`);
