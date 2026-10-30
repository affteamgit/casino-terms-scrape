// Shows what the terms search and Jev (TypeSafe AI) make of one casino: opens the lobby in the local Chrome as
// scrape.mjs does, prints the heuristic candidates, the entries Jev is shown and its answers, follows the first pick
// (or the first heuristic candidate when Jev has none) and prints how the page reads and what Jev judges it to be.
// Usage: node --env-file=.env src/probe-jev.mjs <url> [--headed]
import { chromium } from "playwright-core";
import { settle, dismissCookies, readLobby, readDoc, readsLikeTerms, isParked, notCasino, bodyText, clip } from "./terms.mjs";
import { termsCandidates, isPdf } from "./links.mjs";
import { pdfText } from "./pdf.mjs";
import { jevEnabled, linkEntries, termsLinkQuestions, askJev, jevPicks, linkSummary, termsPageQuestion, acceptsPage, pageSummary } from "./jev.mjs";

const url = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!url) throw new Error("usage: node --env-file=.env src/probe-jev.mjs <url> [--headed]");
const browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed"), args: ["--disable-blink-features=AutomationControlled", "--lang=en-US"] });
try {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const status = resp ? resp.status() : 0;
  const body = await settle(page, status);
  console.log(`opened ${page.url()} (http ${status})`);
  console.log(`cookies dismissed: ${(await dismissCookies(page)) ? "yes" : "no banner"}`);
  const lobby = await readLobby(page);
  const cands = termsCandidates(lobby.links, lobby.url);
  console.log(`lobby ${lobby.url}: ${lobby.links.length} links, ${lobby.clickables.length} clickables, footer ${lobby.footer.length} chars`);
  const lobbyText = `${await bodyText(page)}\n${lobby.footer}`;
  console.log(`lobby verdicts: parked=${isParked(body)} notCasino=${notCasino(lobbyText, cands, lobby.url) || "no"}`);
  console.log("heuristic candidates:", cands.slice(0, 6).map((c) => `${c.score} ${c.href} "${clip(c.text, 30)}"`).join(" | ") || "none");

  const entries = linkEntries(lobby);
  console.log(`jev entries (${entries.length}):`);
  for (const e of entries) console.log(`  ${e.id.padEnd(30)} ${e.kind} "${e.text}" ${e.href}${e.in_footer ? " [footer]" : ""}`);
  let picks = [];
  const q = termsLinkQuestions(entries);
  if (!jevEnabled()) console.log("jev: off (no TYPESAFE_API_KEY)");
  else if (!q) console.log("jev: not asked (no entries)");
  else {
    try {
      const answers = await askJev(q.state, q.questions);
      console.log(`jev link: ${linkSummary(answers)}; has_terms ${answers.has_terms?.noul?.toFixed?.(2) ?? "?"}; choice ${answers.terms_link?.choice ?? "?"}`);
      console.log("  top:", Object.entries(answers.terms_link?.probabilities || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, p]) => `${k} ${p.toFixed(2)}`).join(" | ") || "none");
      picks = jevPicks(answers, entries);
      console.log("  picks:", picks.map((p) => `${p.p.toFixed(2)} ${p.kind} "${p.text}" ${p.href}`).join(" | ") || "none (has_terms under the threshold or no option likely enough)");
    } catch (e) { console.log(`jev link: error ${clip(e.message, 120)}`); }
  }

  // Follow the first Jev pick, else the first heuristic candidate.
  const pick = picks[0] ? { ...picks[0], from: "jev" } : cands[0] ? { ...cands[0], from: "heuristic" } : null;
  if (!pick) { console.log("follow: nothing to follow"); }
  else {
    console.log(`follow (${pick.from}): ${pick.kind === "text" ? `click "${pick.text}"` : pick.href}`);
    let d;
    if (pick.kind === "text") {
      const c = lobby.clickables.find((x) => x.text === pick.text);
      if (c) { await page.click(c.sel, { timeout: 10000 }).catch((e) => console.log(`click failed: ${clip(e.message, 80)}`)); await settle(page); }
    } else if (isPdf(pick.href)) {
      // As the scraper does: the bytes are fetched with the session's cookies and read in Node.
      try { const r = await page.request.get(pick.href, { timeout: 30000 }); if (!r.ok()) throw new Error(`http ${r.status()}`); d = { ok: true, text: await pdfText(await r.body()), pdf: true }; }
      catch (e) { console.log(`pdf failed: ${clip(e.message, 80)}`); d = { ok: false, text: "", note: "pdf unreadable" }; }
    } else {
      await page.goto(pick.href, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => console.log(`goto failed: ${clip(e.message, 80)}`));
    }
    d ||= await readDoc(page, 35000, readsLikeTerms);
    console.log(`page ${d.pdf ? pick.href : page.url()}: ok=${d.ok} ${d.note ? `note=${d.note} ` : ""}${d.hidden ? "hidden " : ""}${d.pdf ? "pdf " : ""}${d.text.length} chars, readsLikeTerms=${readsLikeTerms(d.text)}`);
    console.log(`  ${clip(d.text, 200)}`);
    if (!readsLikeTerms(d.text)) {
      if (!jevEnabled()) console.log("jev page: off");
      else if (d.text.length < 500) console.log("jev page: not asked (text under 500 chars)");
      else {
        const meta = d.pdf ? { url: pick.href, title: "", headings: [] } : await page.evaluate(() => ({ url: location.href, title: document.title, headings: [...document.querySelectorAll("h1, h2, h3")].map((h) => h.innerText.trim()).filter(Boolean) })).catch(() => ({ url: page.url(), title: "", headings: [] }));
        try {
          const pq = termsPageQuestion({ ...meta, text: d.text });
          const pa = await askJev(pq.state, pq.questions);
          console.log(`jev page: ${pageSummary(pa)}; accepted=${acceptsPage(pa)}`);
        } catch (e) { console.log(`jev page: error ${clip(e.message, 120)}`); }
      }
    }
  }
} finally { await browser.close(); }
