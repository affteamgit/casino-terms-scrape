import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { dismissCookies, isParked, englishVariant, isParkedUrl, notCasino, sameAsLobby, fingerprint, guessUrls, GUESS_PATHS, readLobby, readDoc, readsLikeTerms, CLICK_TEXT, CLICK_SKIP, expandSections, marketplaceLobby, isMarketplaceUrl, lobbyStatus, addedText, sitemapChildren, sitemapTerms, fetchTerms, fastInPlace, guessOrder, isShellOf, namesProduct, coreText, BLOCK_TEXT, BLOCK_TEXT_HEAD, CLOSED_TEXT, WAF_TEXT, MARKETPLACE_HOSTS, frameText, otherDocsFor } from "../src/terms.mjs";

test("isParked: for-sale and parking pages, not a casino that merely mentions a domain", () => {
  assert.equal(isParked("Skip to main content Excellent 4.5 out of 5 The domain name ScatterHall.com is for sale! Get this domain Own it today for $2,995, or make an offer."), true);
  assert.equal(isParked("English Copyright © 2026 GoDaddy Operating Company, LLC. Alle Rechte vorbehalten."), true);
  assert.equal(isParked("The domain name ScatterHall.com is for sale!"), true);
  assert.equal(isParked("Secured by GoDaddy. Play slots here. Licensed in Curacao. 18+ Gamble responsibly."), false, "an SSL seal is not a parked page");
  assert.equal(isParked("Welcome. Our partners: jordan.com and sudan.com. Play slots and live games here."), false, "dan.com inside another word");
  assert.equal(isParked("Listed at dan.com. Contact the owner."), true);
  assert.equal(isParked("Welcome to my-dan.com casino. Play slots and live games here."), false, "a hyphenated name ending in dan.com");
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

test("englishVariant: a language prefix becomes /en, anything else is left alone", () => {
  assert.equal(englishVariant("https://spinit2.com/no/rules"), "https://spinit2.com/en/rules");
  assert.equal(englishVariant("https://x.com/ca/rules"), "", "ca is not a language");
  assert.equal(englishVariant("https://x.com/pt-br/termos"), "https://x.com/en/termos");
  assert.equal(englishVariant("https://x.com/terms"), "");
  assert.equal(englishVariant("https://x.com/de"), "https://x.com/en");
  assert.equal(englishVariant("https://x.com/no/rules?a=1#top"), "https://x.com/en/rules?a=1#top");
  assert.equal(englishVariant("not a url"), "");
});

test("notCasino: a review site's disclaimer, unless the lobby links its own terms", () => {
  const review = "megafrenzy.com is an independent review site and does not run any casino. 21+ No purchase necessary T&Cs apply";
  const own = [{ href: "https://megafrenzy.com/terms", score: 10 }];
  assert.match(notCasino(review, [], "https://megafrenzy.com/"), /review/);
  assert.match(notCasino("Some pages. We may earn a commission when you sign up.", [{ href: "https://megafrenzy.com/promo-terms", score: 2 }], "https://megafrenzy.com/"), /commission/);
  assert.equal(notCasino(review, own, "https://megafrenzy.com/"), "", "its own terms link: a casino");
  assert.match(notCasino(review, [{ href: "https://d1.cloudfront.net/t.pdf", score: 8 }], "https://megafrenzy.com/"), /review/, "a candidate on another domain does not count");
  assert.equal(notCasino("Welcome to Example Casino. Join our affiliate programme and refer a friend. Play slots.", [], "https://example.com/"), "", "an affiliate programme page is not the disclaimer");
});

test("sameAsLobby: a hidden text that is the lobby's own is nothing opened", () => {
  const lobby = ("Welcome to the lobby. " + "slots live games ".repeat(300)).trim();
  const ref = { len: lobby.length, fp: fingerprint(lobby) };
  assert.equal(sameAsLobby(lobby, ref), true);
  assert.equal(sameAsLobby(lobby + " extra", ref), true, "same start");
  assert.equal(sameAsLobby("x".repeat(Math.round(lobby.length * 1.04)), ref), true, "within 5% of the length");
  assert.equal(sameAsLobby("General Terms and Conditions. " + "x".repeat(lobby.length * 2), ref), false);
  assert.equal(sameAsLobby("General Terms ".repeat(300), { len: 0, fp: "" }), false, "a lobby with no hidden text");
});

test("isParkedUrl: domain marketplaces and parking services, not casinos", () => {
  assert.equal(isParkedUrl("https://forsale.godaddy.com/forsale/scatterhall.com?utm_source=x"), true);
  assert.equal(isParkedUrl("https://www.sedo.com/search/details/?domain=x.com"), true);
  assert.equal(isParkedUrl("https://dan.com/buy-domain/x.com"), true);
  assert.equal(isParkedUrl("https://www.godaddy.com/"), false);
  assert.equal(isParkedUrl("https://scatterhall.com/"), false);
  assert.equal(isParkedUrl("not a url"), false);
});

test("dismissCookies reads the Danish and French wording of the accept button", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    for (const label of ["ACCEPTER ALLE", "Tout accepter", "Tillad alle"]) {
      await page.setContent(`<html><body><div class="cookie-banner" id="cc"><button>Afvis alle</button><button onclick="document.getElementById('cc').remove()">${label}</button></div></body></html>`);
      assert.equal(await dismissCookies(page), true, label);
      assert.equal(await page.evaluate(() => !!document.getElementById("cc")), false, "the banner is gone");
    }
  } finally { await browser.close(); }
});

test("notCasino: a lookalike domain's terms link is not the casino's own", () => {
  const review = "megafrenzy.com is an independent review site and does not run any casino.";
  assert.match(notCasino(review, [{ href: "https://evilmegafrenzy.com/terms", score: 10 }], "https://megafrenzy.com/"), /review/);
  assert.equal(notCasino(review, [{ href: "https://help.megafrenzy.com/terms", score: 10 }], "https://megafrenzy.com/"), "");
});

test("guessUrls: the twelve likeliest paths, with their language and English variants not counted", () => {
  assert.deepEqual(GUESS_PATHS.slice(0, 6), ["/terms-and-conditions", "/terms", "/terms-of-service", "/rules", "/user-agreement", "/terms-of-use"]);
  const plain = guessUrls("https://x.com", "");
  assert.equal(plain.length, 12);
  assert.ok(plain.includes("https://x.com/rules") && plain.includes("https://x.com/user-agreement"));
  assert.ok(!plain.includes("https://x.com/tc"));
  const no = guessUrls("https://x.com", "/no");
  assert.equal(no.length, 36, "12 paths x (english, lobby language, bare)");
  assert.deepEqual(no.slice(0, 3), ["https://x.com/en/terms-and-conditions", "https://x.com/no/terms-and-conditions", "https://x.com/terms-and-conditions"]);
  assert.equal(guessUrls("https://x.com", "/ca").length, 24, "ca is not a language: no /en variant");
});

// WordPress Cookie Notice puts "cookies-not-set" on <body>, so everything on the page is "inside" a cookie element.
const WP = `<!doctype html><html><body class="cookies-not-set"><header><nav><a href="https://casino.example/continue" onclick="window.__clicked=(window.__clicked||0)+1;return false">Continue</a>
<a href="https://casino.example/ok" onclick="window.__clicked=(window.__clicked||0)+1;return false">OK</a></nav></header>
<main><a href="https://casino.example/agree" onclick="window.__clicked=(window.__clicked||0)+1;return false">Agree</a><p>Play now.</p></main>
<footer><a href="https://casino.example/terms-and-conditions">Terms and Conditions</a><a href="https://casino.example/privacy">Privacy Policy</a><p>${"Licensed and regulated. ".repeat(10)}</p></footer></body></html>`;

test("a cookie class on <body> does not make the whole page a banner", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(WP);
    assert.equal(await dismissCookies(page), false);
    assert.equal(await page.evaluate(() => window.__clicked || 0), 0, "no link was clicked");
    const lobby = await readLobby(page);
    assert.match(lobby.footer, /Terms and Conditions/);
    assert.match(lobby.footer, /Licensed and regulated/);
    assert.equal(lobby.links.find((l) => /terms-and-conditions/.test(l.href)).footer, true);
    assert.equal(lobby.links.find((l) => /continue/.test(l.href)).footer, false);
  } finally { await browser.close(); }
});

test("a registration form that calls itself consent is not a cookie banner", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body><div class="consent-box"><form><input name="email"><input type="password"><input name="x"><button type="button" onclick="window.__clicked=1">Agree</button></form></div></body></html>`);
    assert.equal(await dismissCookies(page), false);
    assert.equal(await page.evaluate(() => window.__clicked || 0), 0);
  } finally { await browser.close(); }
});

const longText = (n) => "Cookie declaration: this site stores small files to remember your choices. ".repeat(Math.ceil(n / 75));

test("a long cookie dialog with its own header, tab nav and page-footer part is still a banner", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body><main><p>Play now.</p></main>
<div class="cookie-information" id="cc" style="position:fixed;top:0;left:0;right:0;background:#fff"><header><h2>Cookies</h2></header><nav><a href="#a">Samtykke</a><a href="#b">Detaljer</a></nav>
<p>${longText(5000)}</p><div class="coi-banner__page-footer"><button>Afvis alle</button><button onclick="document.getElementById('cc').remove()">ACCEPTER ALLE</button></div></div>
<footer><a href="https://casino.example/terms-and-conditions">Terms and Conditions</a><a href="https://casino.example/privacy">Privacy</a><p>${"Licensed and regulated. ".repeat(10)}</p></footer></body></html>`);
    assert.ok((await page.evaluate(() => document.getElementById("cc").innerText.length)) > 4000);
    assert.equal(await dismissCookies(page), true);
    assert.equal(await page.evaluate(() => !!document.getElementById("cc")), false);
    const lobby = await readLobby(page);
    assert.match(lobby.footer, /Terms and Conditions/);
    assert.equal(lobby.links.find((l) => /terms-and-conditions/.test(l.href)).footer, true);
  } finally { await browser.close(); }
});

test("a div-only page wrapped in a consent-classed div is not a banner", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body><div class="consent-app"><div class="content"><p>${longText(4000)}</p>
<a href="https://casino.example/continue" onclick="window.__clicked=(window.__clicked||0)+1;return false">Continue</a></div>
<div class="footer"><a href="https://casino.example/terms-and-conditions">Terms and Conditions</a><p>${"Licensed and regulated. ".repeat(10)}</p></div></div></body></html>`);
    assert.equal(await dismissCookies(page), false);
    assert.equal(await page.evaluate(() => window.__clicked || 0), 0, "nothing clicked");
    const lobby = await readLobby(page);
    assert.match(lobby.footer, /Licensed and regulated/);
    assert.equal(lobby.links.find((l) => /terms-and-conditions/.test(l.href)).footer, true);
  } finally { await browser.close(); }
});

// koalabet.io: the legal links are <a> elements with no href, routed by a click handler.
const ROUTER = `<!doctype html><html><body><main><p>${"Play slots and live games. ".repeat(20)}</p><a href="https://k.io/casino">Casino</a></main>
<div class="bottom"><a onclick="window.__go='tos'">Terms of Service</a><a onclick="window.__go='sb'">Sportsbook Rules</a><a href="#" onclick="window.__go='bonus'">Bonus &amp; Promotional Terms</a>
<a href="javascript:void(0)" onclick="window.__go='ua'">User Agreement</a><span onclick="window.__go='vilkar'">Vilkår</span><a href=""><span onclick="window.__go='gen'">General Conditions</span></a>
<a href="https://k.io/terms-real">Terms and Conditions</a><p>${"A long paragraph that mentions the terms and conditions of play in passing, far too long to be a link. ".repeat(2)}</p></div></body></html>`;

test("readLobby: href-less router anchors and plain elements that read like the terms are clickables (koalabet)", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(ROUTER);
    const lobby = await readLobby(page);
    const texts = lobby.clickables.map((c) => c.text);
    for (const t of ["Terms of Service", "User Agreement", "Vilkår", "General Conditions"]) assert.ok(texts.includes(t), t);
    assert.ok(!texts.includes("Terms and Conditions"), "a real link is a link, not a clickable");
    assert.ok(!texts.some((t) => /Sportsbook|Bonus|passing/.test(t)), "rules, bonus terms and long text are not");
    const tos = lobby.clickables.find((c) => c.text === "Terms of Service");
    await page.evaluate((sel) => document.querySelector(sel).click(), tos.sel);
    assert.equal(await page.evaluate(() => window.__go), "tos", "the selector reaches the element");
  } finally { await browser.close(); }
});

// betportal.com/no/: the footer, with its terms as a plain <span>Vilkår</span>, mounts seconds after the page is scrolled.
const LATE = `<!doctype html><html><body><main style="height:3000px"><p>Spill nå.</p>${Array.from({ length: 12 }, (_, i) => `<a href="https://b.com/no/spill/${i}">Spill ${i}</a>`).join("")}</main>
<script>let armed = false; addEventListener("scroll", () => { if (armed) return; armed = true; setTimeout(() => { const f = document.createElement("footer");
f.innerHTML = '<span>Vilkår</span><span>Personvern</span><a href="https://b.com/no/om">Om oss</a><p>${"Lisensiert og regulert av Spillemyndigheten. ".repeat(40)}</p>'; document.body.appendChild(f); }, 2500); });</script></body></html>`;

test("readLobby waits for a footer that mounts late after scrolling, and reads its plain-text terms (betportal)", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(LATE);
    const lobby = await readLobby(page, { quietMs: 4000 });
    assert.ok(lobby.clickables.some((c) => c.text === "Vilkår" && c.footer), JSON.stringify(lobby.clickables));
    assert.match(lobby.footer, /Spillemyndigheten/);
    assert.ok(lobby.links.some((l) => l.href === "https://b.com/no/om" && l.footer));
  } finally { await browser.close(); }
});

const WORDS = "account deposit withdrawal player bonus wager limit verification identity document licence operator jurisdiction dispute complaint closure fraud collusion software liability warranty breach notice amendment law court currency fee balance session game bet stake winnings jackpot refund chargeback minor age residence country restriction".split(" ");
const SECTION = (i) => `These terms and conditions govern your ${WORDS.map((w, k) => `${w}${(k + i) % 5 ? "" : " terms"}`).join(" ")}. Section ${i}.`;
// betfm.cc: utility-class divs, no aria or accordion class; a section's text mounts only when its title is clicked.
const NUMBERED = (bare) => `<!doctype html><html><body><h1>Terms</h1><div id="jp"><span>5</span><span>7</span><span>1</span><span>9</span></div>
${["Introduction", "General Terms", "Your Obligations", "Restricted Use", "Registration", "Your Account"].map((t, i) => `<div class="flex"><div class="row" onclick="this.parentElement.insertAdjacentHTML('beforeend', '<p>${SECTION(i + 1)}</p>')">${bare ? `<span>${i + 1}</span><span>${t.toUpperCase()}</span>` : `<span>${i + 1}. ${t}</span>`}</div></div>`).join("")}</body></html>`;

test("expandSections opens a run of numbered section titles, with or without the title beside the number (betfm, scored)", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    for (const bare of [false, true]) {
      await page.setContent(NUMBERED(bare));
      assert.equal(await expandSections(page), 6, bare ? "bare numbers" : "numbered titles");
      const t = await page.evaluate(() => document.body.innerText);
      assert.ok(readsLikeTerms(t) && /Section 6\./.test(t));
    }
    // the page wrapped in a div whose class says "menu" (scored): a wrapper, not a menu; a real menu's numbers are skipped
    await page.setContent(NUMBERED(true).replace("<body>", '<body><div class="bg-main menu-closed">').replace("</body>", "</div></body>").replace('<div id="jp">', '<nav class="side-menu"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></nav><div id="jp">'));
    assert.equal(await expandSections(page), 6);
    // a jackpot's digits and fewer than five numbered titles are not sections
    await page.setContent(`<html><body><span>1</span><span>2</span><span>3</span><span>4</span><div>1. One</div></body></html>`);
    assert.equal(await expandSections(page), 0);
  } finally { await browser.close(); }
});

test("readDoc reads the hidden text even when a live element keeps the visible text changing (jasino, tonplay)", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body><div id="tick">0</div><p>Menu Casino Sports</p><div style="display:none">${SECTION(1).repeat(12)}</div>
<script>let n = 0; setInterval(() => { document.getElementById("tick").textContent = "x".repeat(++n % 7); }, 400);</script></body></html>`);
    const t0 = Date.now();
    const d = await readDoc(page, 30000, readsLikeTerms);
    assert.ok(Date.now() - t0 < 8000, "read while unsettled, not at the end of the budget");
    assert.equal(d.ok, true);
    assert.equal(d.hidden, true);
    assert.ok(d.text.length > 3000);
  } finally { await browser.close(); }
});

test("marketplaceLobby: a lobby whose legal links belong to a domain marketplace is a for-sale listing (betfunk, scoobybet)", () => {
  const L = (text, href) => ({ text, href });
  assert.equal(marketplaceLobby([L("Buy now", "https://www.betfunk.com/buy"), L("Terms of Use", "https://dan.com/legal/terms-of-use"), L("Privacy", "https://dan.com/legal/privacy")]), "dan.com");
  assert.equal(marketplaceLobby([L("Privacy policy", "https://www.godaddy.com/legal/agreements/privacy-policy")]), "godaddy.com");
  assert.equal(marketplaceLobby([L("Terms", "https://www.namecheap.com/legal/marketplace/")]), "namecheap.com");
  assert.equal(marketplaceLobby([L("Secured by GoDaddy", "https://seal.godaddy.com/verifySeal?x=1"), L("Terms", "https://casino.example/terms")]), "", "an SSL seal is not a legal link");
  assert.equal(marketplaceLobby([L("Terms and Conditions", "https://casino.example/terms"), L("Sedo", "https://sedo.com/")]), "");
  assert.equal(isMarketplaceUrl("https://dan.com/legal/terms-of-use"), true);
  assert.equal(isMarketplaceUrl("https://www.godaddy.com/legal"), true);
  assert.equal(isMarketplaceUrl("https://evildan.com/legal"), false);
  assert.equal(isMarketplaceUrl("https://casino.example/terms"), false);
});

test("lobbyStatus: a bot check is walled whatever the HTTP code (lumocasino 405 'Human Verification'); a maintenance page is not reached (thestakehouse)", () => {
  const st = (text, httpStatus = 200, finalUrl = "https://casino.example/") => lobbyStatus({ text, httpStatus, finalUrl });
  assert.equal(st("Human Verification\nPlease complete the security check to continue.", 405), "challenge");
  assert.equal(st("Just a moment...", 503), "challenge");
  assert.equal(st("Not Found", 404), "dead_or_empty");
  assert.equal(st("", 200), "dead_or_empty");
  assert.equal(st("Hold Tight, Chico… We're Reloading the House. Back in a couple of hours. With more ways to pay: VISA, Mastercard. Check our socials."), "maintenance");
  assert.equal(st("Site under maintenance. We'll be back soon."), "maintenance");
  assert.equal(st("Welcome to Example Casino. " + "Play slots, live dealer games and sports. ".repeat(100) + "Scheduled maintenance of the sportsbook on Monday."), "ok", "a full lobby that mentions maintenance");
  assert.equal(st("Sorry, this site is not available in your country.", 200), "geo_blocked");
  assert.equal(st("Forbidden", 403), "blocked_http");
  assert.equal(st("The domain name x.com is for sale! Make an offer."), "parked");
  assert.equal(st("x", 200, "https://forsale.godaddy.com/x"), "parked");
  assert.equal(st("Redirecting", 200, "https://casino.guru/go/x"), "stuck_on_tracker");
  assert.equal(st("Welcome to Example Casino. " + "Play slots. ".repeat(50)), "ok");
});

test("lobbyStatus: geo notices in several languages, closed sites, WAF refusals and marketplace error pages (the 719 reached-without-terms rows)", () => {
  const st = (text, httpStatus = 200, finalUrl = "https://casino.example/") => lobbyStatus({ text, httpStatus, finalUrl });
  const pad = " " + "Play slots, live dealer games and sports with fast payouts. ".repeat(4);
  // an English notice that the services are not offered where the visitor lives (888)
  assert.equal(st("Important notice: Please note that 888's services are not being offered to players residing in your location." + pad), "geo_blocked");
  // "unavailable in your location" headline (Mr Green)
  assert.equal(st("MR GREEN UNAVAILABLE IN YOUR LOCATION Thank you for choosing Mr Green, but we are unable to offer our services." + pad), "geo_blocked");
  // a withdrawal notice worded as "no longer available" but naming the visitor's country: the geo form wins over closed
  assert.equal(st("Dear visitor! Due to a management decision, the services of this website are unfortunately no longer available for customers residing in your country." + pad), "geo_blocked");
  // a Brazilian government block page: "acesso bloqueado ... medida provisória"
  assert.equal(st("Governo Federal Acesso bloqueado A plataforma de apostas que você tentou acessar está fora do ar por determinação da Medida Provisória nº 1.394/2026" + pad), "geo_blocked");
  // a Russian "location restriction" notice: "не можем принять игроков"
  assert.equal(st("Ограничение местоположения По юридическим причинам мы не можем принять игроков, проживающих в стране, в которой вы в данный момент находитесь." + pad), "geo_blocked");
  assert.equal(st("Dieses Angebot ist leider in Ihrem Land nicht verfügbar." + pad), "geo_blocked", "German");
  assert.equal(st("Ce site n'est pas disponible dans votre pays." + pad), "geo_blocked", "French");
  assert.equal(st("Este sitio no está disponible en tu país." + pad), "geo_blocked", "Spanish");
  assert.equal(st("Questo sito non è disponibile nel tuo paese." + pad), "geo_blocked", "Italian");
  assert.equal(st("Bu site ülkenizde kullanılamıyor." + pad), "geo_blocked", "Turkish");
  // a site that says it has shut down (europacasino)
  assert.equal(st("EUROPACASINO.COM NO LONGER AVAILABLE Sorry! Europacasino.com is now closed for business. For further information please contact support." + pad), "closed");
  assert.equal(st("Our casino has ceased operations. Thank you for playing with us." + pad), "closed", "ceased operations");
  // a closed notice on a full lobby with its own terms link is a casino announcing something: not closed
  const lobbyLinks = [{ href: "https://casino.example/terms-and-conditions", text: "Terms and Conditions", footer: true }];
  assert.equal(lobbyStatus({ text: "Our sportsbook is closed for business on Sundays. " + pad, finalUrl: "https://casino.example/", links: lobbyLinks }), "ok");
  // likewise a geo notice on a lobby that links its own terms (Entain's help.<brand>.com/closed pages): the terms are read
  assert.equal(lobbyStatus({ text: "Sorry, this site is not available in your country. " + pad, finalUrl: "https://help.casino.example/closed", links: lobbyLinks }), "ok", "geo notice with its own terms link");
  assert.equal(lobbyStatus({ text: "Sorry, this site is not available in your country. " + pad, finalUrl: "https://casino.example/", links: [{ href: "https://other.example/terms-and-conditions", text: "Terms and Conditions", footer: true }] }), "geo_blocked", "another domain's terms link does not count");
  assert.equal(st("Welcome to Example Casino. " + "Play slots, live dealer games and sports. ".repeat(200) + "The old lobby has been closed for business."), "ok", "a long lobby that mentions it");
  // false terminal statuses: a registration step, a bonus line or an account notice is not a closed site
  assert.equal(st("Registrierung abgeschlossen. Vielen Dank, Ihr Konto wurde angelegt." + pad), "ok", "abgeschlossen is not geschlossen");
  assert.equal(st("Welcome to Example Casino. This bonus is no longer available. Pick another offer below." + pad), "ok", "a promo line");
  assert.equal(st("Welcome back. Your account has been closed at your request. Open a new one below." + pad), "ok", "an account notice");
  assert.equal(st("Welcome to Example Casino. This casino bonus is no longer available. Pick another offer below." + pad), "ok", "a bonus with casino in front of it");
  assert.equal(st("We are sorry, this offer is no longer available. Pick another offer below." + pad), "ok", "an offer with we in front of it");
  assert.equal(st("This site is no longer available. Thank you for playing." + pad), "closed", "the site as an explicit subject");
  // availability qualified by a browser, a device or a market is not a closure: those statuses are never retried
  assert.equal(st("Our website is no longer available in your browser version. Please update." + pad), "ok", "a browser-version notice");
  // a market exit is a geo notice, not a closed site
  assert.equal(st("Our casino is no longer accepting players from Norway. Thank you for your understanding." + pad), "geo_blocked", "a market exit");
  assert.equal(st("Please note that this website is no longer accepting new registrations from the United Kingdom." + pad), "geo_blocked", "a market exit, registrations");
  // the real closures stay closed
  assert.equal(st("Europacasino.com is now closed for business. Thank you for playing with us over the years." + pad), "closed", "is now closed for business");
  assert.equal(st("This website has been closed. Thank you for playing with us over the years." + pad), "closed", "has been closed");
  assert.equal(st("Please be advised that Example Casino has officially ceased operations as of 1 March. Players can withdraw their balance until 31 March." + pad), "closed", "the Aspire Global shape");
  assert.equal(st("Unser Casino ist dauerhaft geschlossen. Danke fürs Mitspielen." + pad), "closed", "German, the site as subject");
  // the broad geo wording counts at the head of the page only, not in a lobby's footer disclaimer
  const lobby = (footer) => "Welcome to Example Casino. " + "Play slots, live dealer games and sports with fast payouts. ".repeat(40) + footer;
  assert.ok(lobby("").length > 1500 && lobby("").length < 5000);
  assert.equal(st(lobby("Some promotions are not offered in your country.")), "ok", "footer disclaimer");
  assert.equal(st(lobby("Open to players residing in your country if licensed.")), "ok", "footer disclaimer, residing");
  // an Akamai-style refusal in Slovak: "URL ... zamietnutá", with a support ID
  assert.equal(st("Požadovaná URL adresa bola zamietnutá. Kontaktujte prosím IT podporu. Vaše ID pre podporu je: <678628845435775204>"), "blocked_http");
  assert.equal(st("The request was blocked. Incident ID: 1234-5678" + pad), "blocked_http", "Incapsula-style");
  // an Akamai refusal on the casino's own host is a WAF block, not a geo notice
  assert.equal(st("Access Denied You don't have permission to access \"http://casino.example/\" on this server. Reference #18.abc", 403), "blocked_http");
  assert.equal(st("Access is denied. Reference #18.abc", 200), "blocked_http");
  // a marketplace's own error page is still a parked domain
  assert.equal(st("Access Denied You don't have permission to access \"http://forsale.godaddy.com/forsale/x.com?\" on this server. Reference #18.b48e655f", 403, "https://forsale.godaddy.com/forsale/x.com"), "parked");
  assert.equal(st("Access Denied", 200, "https://www.hugedomains.com/domain_profile.cfm?d=x"), "parked");
  // an ordinary lobby with the terms in its footer is untouched
  assert.equal(st("Welcome to Example Casino. " + "Play slots, live dealer games and sports. ".repeat(20) + "Terms and Conditions | Privacy Policy | Responsible Gaming"), "ok");
  assert.ok(CLOSED_TEXT.test("closed for business") && WAF_TEXT.test("Reference #18") && MARKETPLACE_HOSTS.test("forsale.godaddy.com") && !MARKETPLACE_HOSTS.test("evildan.com"));
  assert.ok(BLOCK_TEXT_HEAD.test("residing in your jurisdiction") && !BLOCK_TEXT.test("residing in your jurisdiction"));
});

test("notCasino: a review site that says how it rates casinos (masterplay.io)", () => {
  assert.match(notCasino("Everything you need to know about how we review and rank casinos and slots.", [], "https://masterplay.io/en"), /how we review and rank casinos/);
  assert.match(notCasino("What makes Masterplay different from other slot review sites?", [], "https://masterplay.io/en"), /slot review sites/);
  assert.equal(notCasino("Welcome to Example Casino. Read our game reviews and rank up in the VIP club.", [], "https://example.com/"), "");
});

test("addedText: what a click opened in place, without the lobby around it (betportal)", () => {
  const lobby = "LOGG INN\nKampanjer\n1. INNSKUDDSBONUS\nVILKÅR\nBONUS PÅ 2. INNSKUDD\nVILKÅR\nVilkår\nPersonvern";
  const after = lobby.replace("Kampanjer", "Kampanjer\nBonusvilkår\n\n\n\nDenne kampanjen er tilgjengelig for nye kunder.\nVILKÅR\nOmsetningskrav 35x");
  assert.equal(addedText(after, lobby), "Bonusvilkår\n\nDenne kampanjen er tilgjengelig for nye kunder.\nOmsetningskrav 35x");
  assert.equal(addedText(lobby, lobby), "");
});

test("readLobby: a text that is both a promo caption and the footer's link is the footer's (betportal)", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body><main><div class="promo"><span id="p1">VILKÅR</span></div><div class="promo"><span id="p2">Vilkår</span></div>
<a href="https://b.com/no/terms-and-conditions">Terms and Conditions</a></main><footer><span id="f">Vilkår</span><p>${"Lisensiert og regulert. ".repeat(10)}</p></footer></body></html>`);
    const lobby = await readLobby(page);
    const v = lobby.clickables.filter((c) => /vilkår/i.test(c.text));
    assert.equal(v.length, 1);
    assert.equal(v[0].footer, true);
    assert.equal(await page.evaluate((sel) => document.querySelector(sel).id, v[0].sel), "f");
    // without a footer, the one lowest on the page
    await page.setContent(`<html><body><div><span id="p1">VILKÅR</span></div><a href="https://b.com/terms">Terms</a><div><span id="p2">Vilkår</span></div></body></html>`);
    const l2 = await readLobby(page);
    assert.equal(await page.evaluate((sel) => document.querySelector(sel).id, l2.clickables.find((c) => /vilkår/i.test(c.text)).sel), "p2");
  } finally { await browser.close(); }
});

test("sitemap picks are judged on the path, not the casino's name (dragonslots-1.com)", () => {
  const o = "https://dragonslots-1.com";
  assert.deepEqual(sitemapChildren([`${o}/sitemap.page-en.xml`, `${o}/sitemap.game-en.xml`, `${o}/sitemap.page-de.xml`, `${o}/sitemap.blog.xml`, `${o}/sitemap.page-es.xml`, `${o}/sitemap.page-it.xml`]),
    [`${o}/sitemap.page-en.xml`, `${o}/sitemap.page-de.xml`, `${o}/sitemap.page-es.xml`]);
  assert.deepEqual(sitemapTerms([`${o}/rules`, `${o}/rules/responsible-gaming`, `${o}/rules/terms-and-conditions`, `${o}/rules/bonus-terms`, `${o}/rules/privacy`]), [`${o}/rules/terms-and-conditions`]);
  assert.deepEqual(sitemapTerms(["https://gamesbet.com/terms", "https://sportcasino.io/en/terms-of-use"]), ["https://gamesbet.com/terms", "https://sportcasino.io/en/terms-of-use"]);
  assert.equal(sitemapTerms(Array.from({ length: 9 }, (_, i) => `https://x.com/${i}/terms`)).length, 4);
});

// The general terms' wording, with no promotion words in it.
const GENERAL = (i) => SECTION(i).replace(/\b(bonus|wager)\b/g, "rule");
// A lobby whose terms caption opens a modal in place. `opening` is the modal's top (HTML); `section` its paragraphs.
const MODAL = (opening, section = SECTION) => `<!doctype html><html><body><main><p>${"Play slots and live games every day. ".repeat(30)}</p>
<div class="card"><a href="#" onclick="return false">T&amp;Cs apply</a></div></main>
<footer><span id="v" onclick="document.body.insertAdjacentHTML('beforeend', document.getElementById('tpl').innerHTML)">Vilkår</span><p>${"Licensed and regulated. ".repeat(6)}</p></footer>
<template id="tpl"><div class="modal">${opening}${Array.from({ length: 12 }, (_, i) => `<p>${i + 1}. ${section(i)}</p>`).join("")}</div></template></body></html>`;

test("an in-place modal that is a promotion is not accepted on the pattern alone; the general terms are (betportal)", async () => {
  const key = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY; // no Jev: only the pattern can accept
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(MODAL("<h2>Welcome Bonus: 150% up to 500 € + 200 free spins</h2>"));
    let lobby = await readLobby(page, { quietMs: 2000 });
    assert.deepEqual(lobby.clickables.map((c) => c.text), ["Vilkår"], "the promo caption 'T&Cs apply' is not a clickable");
    const promo = await fetchTerms(page, lobby);
    assert.equal(promo.text, "", "a bonus modal is not the terms");
    assert.ok(promo.tried.some((t) => /click "Vilkår" \(opened, not terms-like\)/.test(t)), promo.tried.join(" | "));
    // a promotion titled without a promo word, its wagering rules in the body
    await page.setContent(MODAL("<h2>Cash Race</h2><p>Wager €20 or more on any slot during the race week to enter the leaderboard; free spins are credited to the top fifty players daily.</p>", GENERAL));
    lobby = await readLobby(page, { quietMs: 2000 });
    const race = await fetchTerms(page, lobby);
    assert.equal(race.text, "", "a 'Cash Race' modal is not the terms");
    // noise before the title: still the general terms, fast-accepted
    await page.setContent(MODAL("<button>×</button><button>Close</button><h2>General Terms and Conditions</h2>", GENERAL));
    lobby = await readLobby(page, { quietMs: 2000 });
    const general = await fetchTerms(page, lobby);
    assert.equal(general.via, "click", general.tried.join(" | "));
    assert.match(general.text, /General Terms and Conditions/);
  } finally { await browser.close(); if (key !== undefined) process.env.TYPESAFE_API_KEY = key; }
});

test("lobbyStatus: maintenance only for a bare page, not a lobby with a 'under maintenance' banner", () => {
  const text = "Live casino under maintenance. We'll be back soon. " + "Slots, jackpots and table games are open as usual. ".repeat(6);
  const few = [{ href: "https://x.com/", text: "Home" }];
  const many = Array.from({ length: 12 }, (_, i) => ({ href: `https://x.com/g/${i}`, text: `Game ${i}` }));
  assert.equal(lobbyStatus({ text, finalUrl: "https://x.com/", links: few }), "maintenance");
  assert.equal(lobbyStatus({ text, finalUrl: "https://x.com/", links: many }), "ok", "a lobby full of links");
  assert.equal(lobbyStatus({ text, finalUrl: "https://x.com/", links: [...few, { href: "https://x.com/terms-and-conditions", text: "Terms and Conditions", footer: true }] }), "ok", "a lobby that links its terms");
  assert.equal(lobbyStatus({ text, finalUrl: "https://x.com/" }), "maintenance", "no anchors given: the text decides");
});

// An app that serves its lobby shell on every path, with a collapsed block that reads like terms.
// The block comes first in the DOM, so the hidden text does not start like the lobby's visible text.
const SHELL = `<!doctype html><html><body><div style="display:none"><h2>About our terms</h2>${Array.from({ length: 10 }, (_, i) => `<p>${SECTION(i)}</p>`).join("")}</div>
<main><p>${"Spin the reels and win big today. ".repeat(20)}</p></main></body></html>`;

test("a guessed path that serves the lobby shell is not the terms, even when its hidden text reads like terms", async () => {
  const key = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://casino.test/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: SHELL }));
    await page.goto("https://casino.test/");
    const read = await readLobby(page, { quietMs: 2000 });
    const r = await fetchTerms(page, read);
    assert.equal(r.text, "", `accepted ${r.href}`);
    assert.ok(r.tried.some((t) => /sitemap\/guessed paths/.test(t)));
  } finally { await browser.close(); if (key !== undefined) process.env.TYPESAFE_API_KEY = key; }
});

test("marketplaceLobby: a casino that links its own terms is not a listing, whatever else it links", () => {
  const L = (text, href, footer = true) => ({ text, href, footer });
  const listing = [L("Terms of Use", "https://dan.com/legal/terms-of-use"), L("Privacy", "https://dan.com/legal/privacy")];
  assert.equal(marketplaceLobby(listing, "https://www.betfunk.com/"), "dan.com");
  assert.equal(marketplaceLobby([...listing, L("Terms and Conditions", "https://www.betfunk.com/terms-and-conditions")], "https://www.betfunk.com/"), "", "its own terms link: a casino");
  assert.equal(marketplaceLobby([...listing, L("Terms", "https://evilbetfunk.com/terms-and-conditions")], "https://www.betfunk.com/"), "dan.com", "a lookalike domain does not count");
});

test("fastInPlace: an in-place document is fast-accepted only under a general-terms heading with no promotion in sight", () => {
  assert.equal(fastInPlace("General Terms and Conditions\nLast updated 1.10.2026\n1. Introduction\n2. Your Account\n3. Bonuses\n1. Introduction\nThese terms govern your account."), true, "a contents list's section titles are not a promotion");
  const body = "1. These terms govern your account, deposits and withdrawals with the operator.\n2. Eligibility.";
  assert.equal(fastInPlace(`General Terms and Conditions\n${body}`), true);
  assert.equal(fastInPlace(`×\nClose\nNEW\n29.10.2026\nGeneral Terms and Conditions\n${body}`), true, "noise lines before the title");
  assert.equal(fastInPlace(`Vilkår og betingelser\n1. Generell informasjon\n${body}`), true);
  assert.equal(fastInPlace(`Cash Race\nWager €20 on slots to enter. Free spins are credited daily.\n${body}`), false, "a promotion titled without a promo word");
  assert.equal(fastInPlace(`SPOOKY FRIDAY\n50 % FREDAGSBONUS\nVilkår og betingelser\n${body}`), false, "a promo word in the heading");
  assert.equal(fastInPlace(`Terms and Conditions\nThe welcome bonus of 150% carries a 35x wagering requirement; free spins expire in 7 days.`), false, "terms heading over a bonus's terms");
  assert.equal(fastInPlace(""), false, "no heading");
  assert.equal(fastInPlace(`Cash Race\nPrize pool €10,000\nTerms and conditions\n${body}`), false, "a terms sub-heading under a promotion's title");
  assert.equal(fastInPlace(`Spooky Friday\nTerms and conditions\n${body}`), false, "a short promotion title before the terms line");
  assert.equal(fastInPlace(`Close\nLast updated 12.10.2026\nTerms of Service\n${body}`), true, "UI noise and an update date before the title");
  assert.equal(fastInPlace(`×Close\nGeneral Terms and Conditions\n${body}`), true, "two buttons rendered without a space");
  assert.equal(fastInPlace(`General Terms and Conditions\nThese terms cover your account. Free spin offers and free spins winnings follow the general rules.`), true, "'free spin' and 'free spins' are one promotion word");
  assert.equal(fastInPlace(`${"These terms govern your account with the operator. ".repeat(3)}\n${"Deposits and withdrawals are processed daily. ".repeat(3)}`), false, "no short heading line");
  assert.equal(fastInPlace(`Terms and Conditions\nWelcome Offer\n${body}`), false, "a promotion named on the line under the terms heading");
  assert.equal(fastInPlace(`Terms and Conditions\n100% bonus up to 500 EUR\n${body}`), false, "a bonus on the line under the terms heading");
  assert.equal(fastInPlace(`Home\nTerms and Conditions\n${body}`), true, "a Home button is UI noise");
});

test("readLobby: promotion captions are not clickables, but terms whose name merely contains such letters are", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body><main><a href="#">T&amp;Cs apply</a><span>Bonus terms</span><span>Free spins conditions</span></main>
<a href="https://x.com/terms">Terms</a><footer><span>Registration terms</span><span>Terms and conditions</span><p>${"Licensed and regulated. ".repeat(6)}</p></footer></body></html>`);
    const texts = (await readLobby(page, { quietMs: 2000 })).clickables.map((c) => c.text);
    assert.ok(texts.includes("Registration terms") && texts.includes("Terms and conditions"), texts.join(" | "));
    for (const t of ["T&Cs apply", "Bonus terms", "Free spins conditions"]) assert.ok(!texts.includes(t), t);
  } finally { await browser.close(); }
});

test("lobbyStatus: a file-host PDF of terms does not make a maintenance page a lobby", () => {
  const text = "Site under maintenance. We'll be back soon. " + "Thank you for your patience while we upgrade. ".repeat(6);
  const pdf = [{ href: "https://d1.cloudfront.net/terms.pdf", text: "Terms and Conditions", footer: true }];
  assert.equal(lobbyStatus({ text, finalUrl: "https://x.com/", links: pdf }), "maintenance");
});

test("guessOrder: the sitemap's terms URLs, then the sibling guesses, then the common paths", () => {
  const o = "https://x.com";
  const g = guessOrder({ sitemapLocs: [`${o}/rules/terms-and-conditions`, `${o}/blog`], links: [{ text: "Cookie Policy", href: `${o}/dl/cookiepolicy` }], pageUrl: `${o}/`, origin: o, lang: "" });
  const idx = (pred) => g.map((u, i) => (pred(u) ? i : -1)).filter((i) => i >= 0);
  const sitemap = idx((u) => u === `${o}/rules/terms-and-conditions`), siblings = idx((u) => u.startsWith(`${o}/dl/`)), common = idx((u) => !u.startsWith(`${o}/dl/`) && !u.startsWith(`${o}/rules/`));
  assert.ok(sitemap.length && siblings.length && common.length);
  assert.ok(Math.max(...sitemap) < Math.min(...siblings), "every sitemap URL before every sibling");
  assert.ok(Math.max(...siblings) < Math.min(...common), "every sibling before every common path");
  // The general terms next to a rejected promotion's page come after the sitemap's and before the lobby's siblings.
  const p = guessOrder({ sitemapLocs: [`${o}/rules/terms-and-conditions`], links: [{ text: "Cookie Policy", href: `${o}/dl/cookiepolicy` }], pageUrl: `${o}/`, origin: o, lang: "", promoGuesses: [`${o}/en/terms/`] });
  assert.equal(p.indexOf(`${o}/en/terms/`), 1, p.slice(0, 3).join(" "));
});

// Jev, faked: `ask` stands in for askJev. A key is set so the code treats Jev as available; the fake never uses it.
const withJevKey = async (fn) => {
  const key = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "test-key";
  try { return await fn(); } finally { if (key === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = key; }
};
const withoutJev = async (fn) => {
  const key = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try { return await fn(); } finally { if (key !== undefined) process.env.TYPESAFE_API_KEY = key; }
};
// `pick`: the path of the link Jev chooses (none: it sees no terms link); `accept(page)`: its page judgment. `log` records each question asked.
const fakeAsk = ({ pick = null, accept = () => false, log = [] } = {}) => async (state, questions) => {
  log.push(questions.has_terms ? "link" : "page");
  if (questions.has_terms) {
    const e = pick && state.links.find((l) => l.href.endsWith(pick));
    return { has_terms: { noul: e ? 0.95 : 0.1 }, terms_link: { probabilities: e ? { [e.id]: 0.95 } : {} } };
  }
  return { is_terms: { noul: accept(state.page) ? 0.95 : 0.05 } };
};
// A site on casino.test: `pages` maps a path to its HTML; any other path fails to load, so the guess phase is quick.
// Aborted as "aborted": an aborted navigation leaves the page where it was, where any other error shows Chrome's
// error page and interrupts the next navigation.
const site = (page, pages) => page.route("https://casino.test/**", (r) => {
  const p = new URL(r.request().url()).pathname;
  return pages[p] ? r.fulfill({ status: 200, contentType: "text/html", body: pages[p] }) : r.abort("aborted");
});
const TERMS_PAGE = (title = "Terms and Conditions") => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${Array.from({ length: 12 }, (_, i) => `<p>${i + 1}. ${GENERAL(i)}</p>`).join("")}</body></html>`;
const LOBBY = (footer, main = "") => `<!doctype html><html><body><main><p>${"Play slots and live games every day. ".repeat(30)}</p>${main}</main><footer>${footer}<p>${"Licensed and regulated. ".repeat(6)}</p></footer></body></html>`;

test("fetchTerms tries Jev's pick ahead of the scored anchors", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await site(page, {
        "/": LOBBY(`<a href="/terms-and-conditions">Terms and Conditions</a><a href="/legal/user-agreement">User Agreement</a>`),
        "/terms-and-conditions": TERMS_PAGE(), "/legal/user-agreement": TERMS_PAGE("User Agreement"),
      });
      await page.goto("https://casino.test/");
      const lobby = await readLobby(page, { quietMs: 2000 });
      const jev = { notes: [], ask: fakeAsk({ pick: "/legal/user-agreement", accept: () => true }) };
      const r = await fetchTerms(page, lobby, jev);
      assert.equal(r.href, "https://casino.test/legal/user-agreement", r.tried.join(" | "));
      assert.equal(r.via, "jev");
      assert.ok(jev.notes.some((n) => /^link:0\.95/.test(n)), jev.notes.join(" "));
    } finally { await browser.close(); }
  });
});

test("an in-place document with no terms heading is accepted on Jev's judgment", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(MODAL("", GENERAL));
      const lobby = await readLobby(page, { quietMs: 2000 });
      const log = [];
      const r = await fetchTerms(page, lobby, { notes: [], ask: fakeAsk({ accept: (p) => /These terms and conditions govern/.test(p.text), log }) });
      assert.equal(r.via, "click", r.tried.join(" | "));
      assert.match(r.text, /These terms and conditions govern/);
      assert.ok(log.includes("page"), "Jev judged the page");
    } finally { await browser.close(); }
  });
});

// A promotion's terms page that reads like terms: long, and full of "terms".
const PROMO_TERMS_PAGE = `<!doctype html><html><head><title>Bonus Terms</title></head><body><h1>Bonus Terms</h1>${Array.from({ length: 12 }, (_, i) => `<p>${i + 1}. ${SECTION(i)}</p>`).join("")}</body></html>`;

test("a link scored 0 or less is Jev's alone: not opened without Jev or with Jev down, never accepted on the pattern, found on Jev's yes as a low-score link", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await site(page, { "/": LOBBY("", `<a href="/bonus-terms">Bonus Terms</a>`), "/bonus-terms": PROMO_TERMS_PAGE });
    const read = [];
    page.on("request", (r) => { if (r.isNavigationRequest()) read.push(new URL(r.url()).pathname); });
    const search = async (jev) => { await page.goto("https://casino.test/"); read.length = 0; return fetchTerms(page, await readLobby(page, { quietMs: 2000 }), jev); };
    const notOpened = (r, why) => {
      assert.equal(r.text, "", `${why}: accepted ${r.href} via ${r.via}`);
      assert.ok(!read.includes("/bonus-terms"), `${why}: the link was opened`);
      assert.ok(!r.tried.some((t) => t.includes("/bonus-terms")), `${why}: ${r.tried.join(" | ")}`);
    };
    const off = await withoutJev(() => search({ notes: [] }));
    notOpened(off, "no key");
    assert.ok(off.tried.includes("low-score links skipped (Jev off)"), off.tried.join(" | "));
    // Jev down: the footer question failed, so no page question can be asked.
    const down = await withJevKey(() => search({ notes: [], ask: async () => { throw new Error("boom"); } }));
    notOpened(down, "Jev down");
    assert.ok(down.tried.includes("low-score links skipped (Jev down)"), down.tried.join(" | "));
    assert.notEqual(down.via, "promo-terms");
    const log = [];
    const no = await withJevKey(() => search({ notes: [], ask: fakeAsk({ accept: () => false, log }) }));
    assert.equal(no.text, "", `accepted ${no.href}`);
    assert.ok(log.includes("page"), "Jev judged the page");
    // Jev fails on the page question itself: the pattern does not take over.
    const failing = async (state, questions) => { if (questions.is_terms) throw new Error("boom"); return fakeAsk()(state, questions); };
    const fails = await withJevKey(() => search({ notes: [], ask: failing }));
    assert.equal(fails.text, "", `accepted ${fails.href} via ${fails.via}`);
    const yes = await withJevKey(() => search({ notes: [], ask: fakeAsk({ accept: () => true }) }));
    assert.equal(yes.href, "https://casino.test/bonus-terms", yes.tried.join(" | "));
    assert.equal(yes.via, "low-score link");
  } finally { await browser.close(); }
});

// Jev, scripted: `pick` as in fakeAsk; `page` and `excl` are the is_terms and not_general answers; `seen` records each
// page question (`q`: its question, `page`: the state it was sent).
const scriptAsk = ({ pick = null, page = 0.05, excl = 1, seen = [] } = {}) => async (state, questions) => {
  if (questions.has_terms) return fakeAsk({ pick })(state, questions);
  seen.push({ q: Object.keys(questions).join(","), page: state.page });
  return questions.not_general ? { not_general: { type: "noul", noul: excl } } : { is_terms: { type: "noul", noul: page } };
};

test("a borderline page (Jev 0.65) is the terms when Jev also rules out the exclusions, and not when it does not", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await site(page, { "/": LOBBY(`<a href="/info/page-7">Legal</a>`), "/info/page-7": TERMS_PAGE() });
      const search = async (ask) => { await page.goto("https://casino.test/"); const jev = { notes: [], ask }; return { ...(await fetchTerms(page, await readLobby(page, { quietMs: 2000 }), jev)), notes: jev.notes }; };
      const seen = [];
      const yes = await search(scriptAsk({ pick: "/info/page-7", page: 0.65, excl: 0.1, seen }));
      assert.equal(yes.href, "https://casino.test/info/page-7", yes.tried.join(" | "));
      assert.equal(yes.via, "jev");
      assert.deepEqual(seen.map((x) => x.q), ["is_terms", "not_general"], "one judgment: both questions, once");
      assert.equal(seen[1].page.text, seen[0].page.text, "the exclusion question is about the same page");
      assert.ok(yes.notes.includes("page:0.65 excl:0.10"), yes.notes.join(" "));
      const no = await search(scriptAsk({ pick: "/info/page-7", page: 0.65, excl: 0.5 }));
      assert.equal(no.text, "", `accepted ${no.href} via ${no.via}`);
      assert.ok(no.notes.includes("page:0.65 excl:0.50"), no.notes.join(" "));
      // Below the band no exclusion question is asked.
      const low = [];
      const below = await search(scriptAsk({ pick: "/info/page-7", page: 0.45, excl: 0, seen: low }));
      assert.equal(below.text, "", `accepted ${below.href} via ${below.via}`);
      assert.ok(low.every((x) => x.q === "is_terms"), low.map((x) => x.q).join(" "));
    } finally { await browser.close(); }
  });
});

test("a borderline page whose exclusion question fails is not taken on the pattern", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await site(page, { "/": LOBBY(`<a href="/info/page-7">Legal</a>`), "/info/page-7": TERMS_PAGE() });
      await page.goto("https://casino.test/");
      const answer = scriptAsk({ pick: "/info/page-7", page: 0.65 });
      const jev = { notes: [], ask: async (state, questions) => { if (questions.not_general) throw new Error("boom"); return answer(state, questions); } };
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }), jev);
      assert.equal(r.text, "", `accepted ${r.href} via ${r.via}`);
      assert.ok(jev.notes.includes("page:0.65"), jev.notes.join(" "));
      assert.ok(jev.notes.some((n) => n.startsWith("error:")), jev.notes.join(" "));
    } finally { await browser.close(); }
  });
});

test("a low-score page is not hopped from: its document link is not taken on the pattern when Jev fails on the page", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      const pdf = termsPdf(), read = [];
      await site(page, { "/": LOBBY("", `<a href="/bonus-terms">Bonus Terms</a>`), "/bonus-terms": PROMO_TERMS_PAGE.replace("</body>", `<p><a href="/docs/terms.pdf">Download terms</a></p></body>`) });
      await page.route("https://casino.test/docs/terms.pdf", (r) => { read.push("pdf"); return r.fulfill({ status: 200, contentType: "application/pdf", body: pdf }); });
      await page.goto("https://casino.test/");
      const failing = async (state, questions) => { if (questions.is_terms) throw new Error("boom"); return fakeAsk()(state, questions); };
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }), { notes: [], ask: failing });
      assert.equal(r.text, "", `accepted ${r.href} via ${r.via}`);
      assert.ok(r.tried.some((t) => t.startsWith("https://casino.test/bonus-terms (")), r.tried.join(" | "));
      assert.deepEqual(read, [], "the document link was not read");
    } finally { await browser.close(); }
  });
});

test("Jev reads a page's own text, not the lobby's header above it", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await site(page, { "/": LOBBY(`<a href="/info/page-7">Legal</a>`).replace("<body>", `<body>${HEADER}`), "/info/page-7": TERMS_PAGE().replace("<body>", `<body>${HEADER}`) });
      await page.goto("https://casino.test/");
      const seen = [];
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }), { notes: [], ask: scriptAsk({ pick: "/info/page-7", page: 0.95, seen }) });
      assert.equal(r.href, "https://casino.test/info/page-7", r.tried.join(" | "));
      assert.match(r.text, /^\s*Game category 0/, "the page itself opens with the lobby's header");
      assert.equal(seen.length, 1);
      assert.equal(seen[0].page.core, true);
      assert.ok(!/Game category/.test(seen[0].page.text.slice(0, 200)), `Jev saw the header: ${seen[0].page.text.slice(0, 120)}`);
      assert.match(seen[0].page.text, /^Terms and Conditions 1\. These terms and conditions govern/);
    } finally { await browser.close(); }
  });
});

test("a rejected bonus-terms page leads to the general terms next to it, guessed before the common paths (/en/terms/bonus/ -> /en/terms/)", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await site(page, { "/": LOBBY(`<a href="/en/terms/bonus/">Bonus Terms</a>`), "/en/terms/bonus/": PROMO_TERMS_PAGE, "/en/terms/": TERMS_PAGE() });
      const read = [];
      page.on("request", (r) => { if (r.isNavigationRequest()) read.push(new URL(r.url()).pathname); });
      const search = async (pick) => { await page.goto("https://casino.test/"); read.length = 0; return fetchTerms(page, await readLobby(page, { quietMs: 2000 }), { notes: [], ask: fakeAsk({ pick, accept: (p) => !/bonus/i.test(p.url) }) }); };
      // Jev picks the bonus terms; the page read rejects them.
      const picked = await search("/en/terms/bonus/");
      assert.equal(picked.href, "https://casino.test/en/terms/", picked.tried.join(" | "));
      assert.equal(picked.via, "guess");
      assert.ok(picked.tried.some((t) => t.startsWith("https://casino.test/en/terms/bonus/ (")), picked.tried.join(" | "));
      assert.ok(!read.includes("/terms-and-conditions"), `a common path was guessed first: ${read.join(" ")}`);
      // The bonus terms are only a low-scored link: the general terms next to them are still guessed after Jev rejects them.
      const low = await search(null);
      assert.equal(low.href, "https://casino.test/en/terms/", low.tried.join(" | "));
      assert.equal(low.via, "guess");
    } finally { await browser.close(); }
  });
});

test("a Jev pick the heuristic does not score is accepted on Jev's page judgment, not on the pattern", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await site(page, { "/": LOBBY(`<a href="/info/page-7">Legal</a>`), "/info/page-7": TERMS_PAGE() });
      const search = async (accept) => { await page.goto("https://casino.test/"); return fetchTerms(page, await readLobby(page, { quietMs: 2000 }), { notes: [], ask: fakeAsk({ pick: "/info/page-7", accept }) }); };
      const yes = await search(() => true);
      assert.equal(yes.href, "https://casino.test/info/page-7", yes.tried.join(" | "));
      assert.equal(yes.via, "jev");
      const no = await search(() => false);
      assert.equal(no.text, "", `accepted ${no.href}`);
    } finally { await browser.close(); }
  });
});

test("a footer link that an app routes to its lobby shell is not the terms, even when the shell's hidden text reads like terms", async () => {
  await withoutJev(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      const body = SHELL.replace("</body>", `<footer><a href="/terms">Terms and Conditions</a><p>${"Licensed and regulated. ".repeat(6)}</p></footer></body>`);
      await page.route("https://casino.test/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body }));
      await page.goto("https://casino.test/");
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }));
      assert.equal(r.text, "", `accepted ${r.href} via ${r.via}`);
      assert.ok(r.tried.includes("https://casino.test/terms (lobby shell)"), r.tried.join(" | "));
    } finally { await browser.close(); }
  });
});

// A PDF whose text reads like terms, built here (as in pdf.test.mjs) so the test needs no fixture file.
function termsPdf() {
  const lines = ["General Terms and Conditions", ...Array.from({ length: 40 }, (_, i) => `${i + 1}. These terms and conditions govern your account, deposits and withdrawals, rule ${i}.`)];
  const stream = `BT /F1 10 Tf 20 800 Td 12 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("a PDF is fetched inside the page when it is same-origin, and from Node when the page may not read it (CORS)", async () => {
  const pdf = termsPdf(), hits = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/terms.pdf") {
      hits.push({ host: req.headers.host, mode: req.headers["sec-fetch-mode"] || "" });
      res.writeHead(200, { "content-type": "application/pdf", "content-length": pdf.length });
      return res.end(pdf);
    }
    if (u.pathname === "/") {
      const href = u.searchParams.get("pdf") === "cross" ? `http://localhost:${port}/terms.pdf` : "/terms.pdf";
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(LOBBY(`<a href="${href}">Terms and Conditions</a>`));
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<html><body>Not found</body></html>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await withoutJev(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      for (const kind of ["same", "cross"]) {
        hits.length = 0;
        await page.goto(`http://127.0.0.1:${port}/?pdf=${kind}`);
        const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }));
        assert.equal(r.pdf, true, `${kind}: ${r.tried.join(" | ")}`);
        assert.match(r.text, /General Terms and Conditions/);
        if (kind === "same") assert.deepEqual(hits.map((h) => h.mode), ["cors"], "one request, from the page");
        else assert.deepEqual(hits.map((h) => h.mode), ["cors", ""], "the page's request is refused by CORS; Node's follows");
      }
    } finally { await browser.close(); server.close(); }
  });
});

test("isShellOf: the lobby's opening and next to nothing of its own beyond the lobby's header and footer", () => {
  const header = "Casino Live Sports Promotions VIP Login Register ".repeat(8), grid = "Spin the reels and win big today. ".repeat(80);
  const footer = " Terms and Conditions. Privacy Policy. Responsible Gaming. Licensed and regulated.";
  const lobby = (header + grid + footer).trim();
  const ref = { len: lobby.length, fp: fingerprint(lobby) };
  assert.equal(isShellOf(lobby, ref, lobby), true, "the lobby itself");
  assert.equal(isShellOf(header + grid.slice(0, 1200) + "Loading... " + grid.slice(1200) + footer, ref, lobby), true, "the lobby with a loading spinner line");
  assert.equal(isShellOf(lobby.slice(0, 2000) + " a ticker".repeat(30), ref, lobby), true, "the same first 2,000 characters");
  assert.equal(isShellOf((header + "Page not found. Back to home" + footer).trim(), ref, lobby), true, "a 404 shell: the header, a line and the footer");
  assert.equal(isShellOf(lobby.slice(0, 300) + " General Terms and Conditions ".repeat(Math.ceil(lobby.length * 2 / 30)), ref, lobby), false, "same header, three times as long");
  assert.equal(isShellOf("x".repeat(lobby.length), ref, lobby), false, "same length, another opening");
  assert.equal(isShellOf("anything", { len: 0, fp: "" }, ""), false, "no lobby text");
  const terms = " These terms and conditions govern your account and the agreement with the operator.";
  const near = lobby.slice(0, 300) + terms.repeat(Math.ceil((lobby.length * 1.05 - 300) / terms.length));
  assert.ok(Math.abs(near.length - lobby.length * 1.05) < terms.length);
  assert.equal(isShellOf(near, ref, lobby), false, "a terms page under the lobby's 300-character header at 1.05 times its length");
  // elarabet.com: a 2,500-character menu and a 5,000-character SEO footer (10 terms words) around every page; the terms
  // page's own part is 13,000 characters, mostly a restricted-countries list, with few terms words of its own.
  const menu = "Wheel of Fortune Daily Mystery Bonuses Casino Sport Promotions All Promotions Slots New Popular ".repeat(27);
  const seoTerms = " All play is subject to our terms and conditions.".repeat(5);
  const seo = " Play slots, live games and sports with fast payouts every day.".repeat(80).slice(0, 5000 - seoTerms.length) + seoTerms;
  const countries = " Afghanistan, Albania, Algeria, Belarus, Cuba, Iran, North Korea, Syria, United States, France, Netherlands.".repeat(125);
  const elaraLobby = (menu + grid + seo).trim(), elaraRef = { len: elaraLobby.length, fp: fingerprint(elaraLobby) };
  const elaraTerms = (menu + "Terms and Conditions. Players from the following countries may not open an account:" + countries + seo).trim();
  assert.ok(menu.length >= 2500 && seo.length === 5000 && (seo.match(/terms|conditions/gi) || []).length === 10 && countries.length >= 13000);
  assert.equal(fingerprint(elaraTerms), elaraRef.fp, "the menu alone fills the fingerprint");
  assert.equal(isShellOf(elaraTerms, elaraRef, elaraLobby), false, "elarabet's terms: a country list under the lobby's menu and over its footer");
  assert.equal(isShellOf((menu + "Page not found. Back to home" + seo).trim(), elaraRef, elaraLobby), true, "a 404 shell under the long menu");
  assert.equal(isShellOf(elaraLobby, elaraRef, elaraLobby), true);
  // the SHELL fixture: the same page on every path is the shell
  assert.equal(isShellOf(SHELL, { len: SHELL.length, fp: fingerprint(SHELL) }, SHELL), true);
});

test("coreText: what a page adds between the lobby's shared opening and shared ending, the two never overlapping", () => {
  assert.equal(coreText("Menu  A B\nOwn part\nFooter X", "Menu A B Games Footer X"), "Own part");
  assert.equal(coreText("Menu Footer", "Menu Games Footer"), "");
  assert.equal(coreText("abcabc", "abc"), "abc", "the prefix took the lobby's whole text: no suffix is taken from the rest");
  assert.equal(coreText("same", "same"), "");
});

// A lobby whose header holds more than 300 characters of navigation, and a terms page under the same header.
const HEADER = `<header><nav>${Array.from({ length: 40 }, (_, i) => `<a href="/games/${i}">Game category ${i}</a>`).join(" ")}</nav></header>`;

test("a footer link to a terms page that opens with the lobby's header is the terms, not the lobby shell", async () => {
  await withoutJev(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      const terms = TERMS_PAGE().replace("<body>", `<body>${HEADER}`);
      await site(page, { "/": LOBBY(`<a href="/terms-and-conditions">Terms and Conditions</a>`).replace("<body>", `<body>${HEADER}`), "/terms-and-conditions": terms });
      await page.goto("https://casino.test/");
      const lobbyText = await page.evaluate(() => document.body.innerText);
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }));
      assert.equal(r.href, "https://casino.test/terms-and-conditions", r.tried.join(" | "));
      assert.equal(r.text.slice(0, 300), lobbyText.slice(0, 300), "the page opens with the lobby's header");
      assert.ok(r.text.length > lobbyText.length * 3);
    } finally { await browser.close(); }
  });
});

test("a Jev pick that is also a heuristic candidate keeps that candidate's score: a promotion's terms link is still judged by Jev", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      // The same href in the page (score 0, the candidate kept) and in the footer (score 2, what the pick would score alone).
      await site(page, { "/": LOBBY(`<a href="/bonus-terms">Bonus Terms</a>`, `<a href="/bonus-terms">Bonus Terms</a>`), "/bonus-terms": PROMO_TERMS_PAGE });
      await page.goto("https://casino.test/");
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }), { notes: [], ask: fakeAsk({ pick: "/bonus-terms", accept: () => false }) });
      assert.equal(r.text, "", `accepted ${r.href} via ${r.via}`);
    } finally { await browser.close(); }
  });
});

// elarabet.com: a menu of more than 2,500 characters opens the lobby and every page under it; Jev picks the general
// terms, and the footer also links a sportsbook's terms (its path misspelled, so the path does not name the product).
const MENU = `<header><nav>${Array.from({ length: 200 }, (_, i) => `<a href="/c/${i}">${["Wheel of Fortune", "Daily Mystery", "Bonuses", "Casino", "Sport", "Promotions", "Slots", "New", "Popular"][i % 9]} ${i}</a>`).join(" ")}</nav></header>`;
const ELARA_FOOTER = `<a href="/terms-and-conditions">Terms and Conditions</a> | <a href="/spotsbook-terms-and-conditions">Sportsbook Terms &amp; Conditions</a>`;
// elarabet's page shape: the menu, the page's own part, and a footer with an SEO block (10 terms words with its links).
const ELARA_SEO = `<p>${"Play slots, live games and sports with fast payouts every day. ".repeat(40)}${"All play is subject to our terms and conditions. ".repeat(3)}</p>`;
const ELARA_PAGE = (main) => `<!doctype html><html><body>${MENU}<main>${main}</main><footer>${ELARA_FOOTER}${ELARA_SEO}</footer></body></html>`;
const COUNTRY_LIST = `<h1>Terms and Conditions</h1><p>Players from the following countries may not open an account:</p><ul>${Array.from({ length: 600 }, (_, i) => `<li>Country ${i}: ${["Afghanistan", "Albania", "Belarus", "Cuba", "Iran", "Syria"][i % 6]}</li>`).join("")}</ul>`;

test("a terms page under the lobby's long menu (the same first 2,000 characters) is the terms, not the lobby shell (elarabet)", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      const read = [];
      page.on("request", (r) => { if (r.isNavigationRequest()) read.push(new URL(r.url()).pathname); });
      await site(page, {
        "/": ELARA_PAGE(`<p>${"Play slots and live games every day. ".repeat(30)}</p>`),
        "/terms-and-conditions": ELARA_PAGE(COUNTRY_LIST),
        "/spotsbook-terms-and-conditions": ELARA_PAGE(`<h1>Sportsbook Terms and Conditions</h1>${Array.from({ length: 12 }, (_, i) => `<p>${GENERAL(i)}</p>`).join("")}`),
      });
      await page.goto("https://casino.test/");
      const lobbyText = await page.evaluate(() => document.body.innerText);
      assert.ok(lobbyText.indexOf("Play slots") >= 2500, "the menu runs past 2,500 characters");
      const count = (t) => (t.match(/\bterms?\b|\bconditions?\b/gi) || []).length;
      assert.equal(count(lobbyText), 10, "the lobby's footer holds 10 terms words");
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }), { notes: [], ask: fakeAsk({ pick: "/terms-and-conditions", accept: () => true }) });
      assert.equal(r.href, "https://casino.test/terms-and-conditions", r.tried.join(" | "));
      assert.ok(!read.includes("/spotsbook-terms-and-conditions"), "the sportsbook's terms were never read");
    } finally { await browser.close(); }
  });
});

test("a link whose caption names a product is not fast-accepted while Jev is up; without Jev the pattern decides as before", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    // The general terms do not load (any path not listed fails), so the sportsbook's terms are the next candidate.
    await site(page, { "/": LOBBY(ELARA_FOOTER), "/spotsbook-terms-and-conditions": TERMS_PAGE("Sportsbook Terms and Conditions") });
    const search = async (jev) => { await page.goto("https://casino.test/"); return fetchTerms(page, await readLobby(page, { quietMs: 2000 }), jev); };
    const log = [];
    const no = await withJevKey(() => search({ notes: [], ask: fakeAsk({ accept: () => false, log }) }));
    assert.equal(no.text, "", `accepted ${no.href}`);
    assert.ok(log.includes("page"), "Jev judged the page");
    const off = await withoutJev(() => search({ notes: [] }));
    assert.equal(off.href, "https://casino.test/spotsbook-terms-and-conditions", off.tried.join(" | "));
    const yes = await withJevKey(() => search({ notes: [], ask: fakeAsk({ accept: () => true }) }));
    assert.equal(yes.href, "https://casino.test/spotsbook-terms-and-conditions", yes.tried.join(" | "));
  } finally { await browser.close(); }
});

test("namesProduct: a product or promotion named by the caption or the path, unless it also says casino", () => {
  const n = (text, path) => namesProduct({ text, href: `https://x.com${path}` });
  assert.equal(n("Sportsbook Terms & Conditions", "/spotsbook-terms-and-conditions"), true);
  assert.equal(n("Terms", "/poker/terms"), true);
  assert.equal(n("Bonus Terms", "/terms"), true);
  assert.equal(n("Promotions T&Cs", "/terms"), true);
  assert.equal(n("Casino & Sports Terms", "/terms-and-conditions"), false);
  assert.equal(n("Terms and Conditions", "/terms-and-conditions"), false);
  assert.equal(n("Terms", "/casino/sportsbook-terms"), false, "the path says casino");
});

// clubscasino.com: the terms page is a stub under the lobby's own header and footer that only links its PDF. Its path
// is not one the guess phase tries, so only the hop from the link's own page finds the document.
test("a stub that shows the lobby with a link to the terms document is hopped from, not dropped as the lobby shell", async () => {
  await withoutJev(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      const lobbyHtml = LOBBY(`<a href="/info/tos-page">Terms of Use</a>`);
      const stub = lobbyHtml.replace("<html>", "<html><head><title>Terms of Use</title></head>").replace("</footer>", `<a href="/docs/terms.pdf">Download the Terms of Use</a></footer>`);
      const pdf = termsPdf();
      await page.route("https://casino.test/**", (r) => {
        const p = new URL(r.request().url()).pathname;
        if (p === "/") return r.fulfill({ status: 200, contentType: "text/html", body: lobbyHtml });
        if (p === "/info/tos-page") return r.fulfill({ status: 200, contentType: "text/html", body: stub });
        if (p === "/docs/terms.pdf") return r.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
        return r.abort("aborted");
      });
      await page.goto("https://casino.test/");
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }));
      assert.ok(r.tried.includes("https://casino.test/info/tos-page (lobby shell)"), r.tried.join(" | "));
      assert.equal(r.pdf, true, r.tried.join(" | "));
      assert.equal(r.href, "https://casino.test/docs/terms.pdf");
    } finally { await browser.close(); }
  });
});

// A lobby whose header and footer read like terms on their own (the footer's SEO block and its "Terms and Conditions"
// link hold 8 terms words), and pages under the same header and footer: the shell alone passes readsLikeTerms.
// `menu`: the lobby's header (HEADER), or the same links in a plain <div class="menu"> (DIV_MENU), which the hidden text
// keeps: hiddenTextInPage strips only header, nav and footer.
const CHROME = (main, end = "", menu = HEADER) => `<!doctype html><html><body>${menu}<main>${main}</main><footer><a href="/terms.html">Terms and Conditions</a>${ELARA_SEO}</footer>${end}</body></html>`;
const CHROME_LOBBY = CHROME(`<p>${"Play slots and live games every day. ".repeat(30)}</p>`);
const DIV_MENU = HEADER.replace("<header><nav>", '<div class="menu">').replace("</nav></header>", "</div>");
const DIV_LOBBY = CHROME(`<p>${"Play slots and live games every day. ".repeat(30)}</p>`, "", DIV_MENU);
const GENERALS = (n) => Array.from({ length: n }, (_, i) => `<p>${i + 1}. ${GENERAL(i)}</p>`).join("");
const INTRO = `<h1>Terms and Conditions</h1><p>${"Please read these terms carefully before you play. ".repeat(6)}</p>`;
// `terms`: the HTML /terms.html serves; `lobby`: the HTML / serves. The search runs without Jev; `ms` is how long it took.
const searchChrome = (terms, lobby = CHROME_LOBBY) => withoutJev(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await site(page, { "/": lobby, "/terms.html": terms });
    await page.goto("https://casino.test/");
    const lobbyText = await page.evaluate(() => document.body.innerText);
    assert.ok(readsLikeTerms(lobbyText), "the lobby's own chrome reads like terms");
    const read = await readLobby(page, { quietMs: 2000 });
    const t0 = Date.now();
    const r = await fetchTerms(page, read);
    return { ...r, ms: Date.now() - t0 };
  } finally { await browser.close(); }
});

test("a terms page that shows the lobby's header and footer first and its document 4 s later is read once the document arrives", async () => {
  const late = `<script>setTimeout(() => { document.querySelector("main").innerHTML = ${JSON.stringify(INTRO + GENERALS(12))}; }, 4000)</script>`;
  const r = await searchChrome(CHROME("", late));
  assert.equal(r.href, "https://casino.test/terms.html", r.tried.join(" | "));
  assert.match(r.text, /1\. These terms and conditions govern/);
  assert.ok(r.text.length >= 4000);
});

test("a terms page under the lobby's chrome whose 60,000 characters sit in closed <details> is read", async () => {
  const parts = Array.from({ length: 10 }, (_, k) => `<details><summary>Part ${k + 1}</summary>${GENERALS(14)}</details>`).join("");
  const r = await searchChrome(CHROME(INTRO + parts));
  assert.equal(r.href, "https://casino.test/terms.html", r.tried.join(" | "));
  assert.ok(r.text.length >= 60000, `${r.text.length} chars`);
});

test("a shell whose hidden document is shorter than three times the visible chrome yields the hidden text, judged as the terms", async () => {
  const r = await searchChrome(CHROME(INTRO + `<div hidden>${GENERALS(11)}</div>`));
  assert.equal(r.href, "https://casino.test/terms.html", r.tried.join(" | "));
  assert.equal(r.hidden, true);
  assert.match(r.text, /11\. These terms and conditions govern/);
});

test("a 404 page that is the lobby's chrome around a 'not found' line is still the lobby shell", async () => {
  const r = await searchChrome(CHROME(`<h1>Page not found</h1><p>${"Sorry, this page could not be found. ".repeat(5)}</p>`));
  assert.equal(r.text, "", `accepted ${r.href} via ${r.via}`);
  assert.ok(r.tried.includes("https://casino.test/terms.html (lobby shell)"), r.tried.join(" | "));
});

// A lobby whose <main> opens with a ticker that differs on every load and goes on with an SEO block that reads like
// terms: its hidden text (from <main>, without header and footer) never opens the same way twice.
const TICKER_PAGE = CHROME(`<p id="tk"></p>${ELARA_SEO}`, `<script>document.getElementById("tk").textContent = Math.floor(Math.random() * 1e9) + " players online now";</script>`);

test("a shell whose hidden text is the lobby's own behind a ticker that differs on each load is not the terms", async () => {
  const r = await searchChrome(TICKER_PAGE, TICKER_PAGE);
  assert.equal(r.text, "", `accepted ${r.href} via ${r.via}`);
  assert.ok(r.tried.includes("https://casino.test/terms.html (lobby shell)"), r.tried.join(" | "));
});

// A lobby that hides a long SEO block reading like terms (over 3 times its visible text), served on every page.
const HIDDEN_SEO = `<div hidden>${Array.from({ length: 40 }, (_, i) => `<p>${SECTION(i)}</p>`).join("")}</div>`;

test("a terms page that arrives 4 s after a shell offering the lobby's long hidden text is read once it arrives", async () => {
  const late = `<script>setTimeout(() => { document.querySelector("main").innerHTML = ${JSON.stringify(INTRO + GENERALS(12))}; }, 4000)</script>`;
  const r = await searchChrome(CHROME("", HIDDEN_SEO + late), CHROME(`<p>${"Play slots and live games every day. ".repeat(30)}</p>`, HIDDEN_SEO));
  assert.equal(r.href, "https://casino.test/terms.html", r.tried.join(" | "));
  assert.match(r.text, /12\. These terms and conditions govern/);
  assert.ok(!r.hidden, "the visible document, not the lobby's hidden text");
});

test("an accordion under the lobby's chrome whose sections open on an aria-expanded button is read once they are open", async () => {
  const parts = Array.from({ length: 10 }, (_, k) => `<button aria-expanded="false" onclick="this.setAttribute('aria-expanded', 'true'); this.nextElementSibling.hidden = false">Part ${k + 1}</button><div hidden><p>${k + 1}. ${GENERAL(k)}</p></div>`).join("");
  const r = await searchChrome(CHROME(INTRO + parts));
  assert.equal(r.href, "https://casino.test/terms.html", r.tried.join(" | "));
  assert.match(r.text, /10\. These terms and conditions govern/);
  assert.ok(!r.hidden, "read from the opened sections, not the hidden text");
});

test("under a <div> menu that the hidden text keeps, a hidden terms document is still the terms (not the lobby's hidden shell)", async () => {
  assert.ok(DIV_MENU.replace(/<[^>]+>/g, "").length >= 600, "a menu of 600 characters or more");
  const r = await searchChrome(CHROME(INTRO + `<div hidden>${GENERALS(11)}</div>`, "", DIV_MENU), DIV_LOBBY);
  assert.equal(r.href, "https://casino.test/terms.html", r.tried.join(" | "));
  assert.equal(r.hidden, true);
  assert.match(r.text, /11\. These terms and conditions govern/);
});

test("under a <div> menu that the hidden text keeps, a document that arrives 4 s after the shell is read when it arrives, not at the budget", async () => {
  const late = `<script>setTimeout(() => { document.querySelector("main").innerHTML = ${JSON.stringify(INTRO + GENERALS(12))}; }, 4000)</script>`;
  const r = await searchChrome(CHROME("", late, DIV_MENU), DIV_LOBBY);
  assert.equal(r.href, "https://casino.test/terms.html", r.tried.join(" | "));
  assert.match(r.text, /12\. These terms and conditions govern/);
  assert.ok(r.ms < 20000, `took ${r.ms} ms`);
});

// A lobby with no terms link, no clickable and no candidates: Jev is asked what the page is.
const NO_LINKS_LOBBY = LOBBY(`<a href="/about">About us</a><a href="/blog">Blog</a>`);
const lobbyAsk = ({ option = "not_gambling_site", p = 0.9, confidence = 0.9, log = [], seen = [] } = {}) => async (state, questions) => {
  if (!questions.kind) return fakeAsk()(state, questions);
  log.push("kind"); seen.push(state);
  return { kind: { type: "choice", choice: option, confidence, probabilities: { [option]: p, gambling_site: 1 - p } } };
};

test("a lobby with no terms link is classified by Jev's lobby judgment: not a gambling site becomes lobbyClass not_casino, a gambling site stays unclassified", async () => {
  await withJevKey(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await site(page, { "/": NO_LINKS_LOBBY.replace("<body>", "<head><title>Top Casinos Reviewed</title></head><body>") });
      const search = async (jev) => { await page.goto("https://casino.test/"); return fetchTerms(page, await readLobby(page, { quietMs: 2000 }), jev); };
      const seen = [];
      const jev = { notes: [], ask: lobbyAsk({ seen }) };
      const r = await search(jev);
      assert.equal(r.lobbyClass, "not_casino");
      assert.ok(!r.text, "no terms found");
      assert.ok(jev.notes.includes("lobby:not_gambling_site:0.90"), jev.notes.join(" "));
      assert.equal(seen.length, 1);
      assert.equal(seen[0].page.url, "https://casino.test/");
      assert.match(seen[0].page.text, /Play slots and live games/);
      assert.ok(seen[0].page.captions.includes("About us"), seen[0].page.captions.join(","));
      const casino = await search({ notes: [], ask: lobbyAsk({ option: "gambling_site", p: 0.95 }) });
      assert.equal(casino.lobbyClass ?? null, null);
      const unsure = await search({ notes: [], ask: lobbyAsk({ confidence: 0.4 }) });
      assert.equal(unsure.lobbyClass ?? null, null, "an unsure answer leaves the regex result");
    } finally { await browser.close(); }
  });
});

test("the lobby judgment fails open: no key, a failed call, and a lobby that has a terms link never classify", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const search = async (jev) => { await page.goto("https://casino.test/"); return fetchTerms(page, await readLobby(page, { quietMs: 2000 }), jev); };
    await site(page, { "/": NO_LINKS_LOBBY });
    const log = [];
    const off = await withoutJev(() => search({ notes: [], ask: lobbyAsk({ log }) }));
    assert.equal(off.lobbyClass ?? null, null);
    assert.deepEqual(log, [], "no key, no question");
    const jev = { notes: [], ask: async () => { throw new Error("boom"); } };
    const down = await withJevKey(() => search(jev));
    assert.equal(down.lobbyClass ?? null, null);
    assert.ok(jev.notes.some((n) => n.startsWith("error:")), jev.notes.join(" "));
    await page.unroute("https://casino.test/**");
    await site(page, { "/": LOBBY(`<a href="/terms-and-conditions">Terms and Conditions</a>`), "/terms-and-conditions": TERMS_PAGE() });
    const withLink = await withJevKey(() => search({ notes: [], ask: lobbyAsk({ log }) }));
    assert.equal(withLink.lobbyClass ?? null, null);
    assert.ok(withLink.text, "the terms were found");
    assert.deepEqual(log, [], "the lobby question is not asked when the lobby has a terms link");
  } finally { await browser.close(); }
});

test("readsLikeTerms: a 2,000-character text counts the terms words of other languages, and ordinary lobby text does not", () => {
  const sr = "Opšti uslovi korišćenja. " + "Igrač prihvata ove uslovi korišćenja. ".repeat(60);
  assert.ok(sr.length >= 2000 && readsLikeTerms(sr));
  assert.ok(!readsLikeTerms("Opšti uslovi i pravila. ".repeat(50)), "under 2,000 characters");
  assert.ok(readsLikeTerms(("お客様は利用規約に同意するものとします。" + "x".repeat(20)).repeat(80)));
  assert.ok(readsLikeTerms(("Kullanım Şartları ve Koşullar gereği kurallar uygulanır. " + "x".repeat(10)).repeat(40)));
  assert.ok(!readsLikeTerms("Oyun kuralları: slot oyunları, canlı casino ve spor bahisleri. ".repeat(60)), "Turkish game rules are not terms");
  // rules and policy words alone do not make a page terms: a privacy policy, a game's rules
  assert.ok(!readsLikeTerms("Adatvédelmi szabályzat. Az adatkezelő személyes adatokat kezel a játékosról. ".repeat(30)), "Hungarian privacy policy");
  assert.ok(!readsLikeTerms("Pravila igre. Igrač dobija žetone na početku svake runde ruleta. ".repeat(32)), "Serbian game rules");
  assert.ok(!readsLikeTerms("游戏规则：玩家在每轮开始时下注，赢得的奖金将计入余额。".repeat(80)), "Chinese game rules");
  assert.ok(!readsLikeTerms("Play slots, live casino and jackpots with the best pravilan games. Termination is easy. ".repeat(40)));
});

test("CLICK_TEXT matches terms captions across languages and not game rules", () => {
  const re = new RegExp(CLICK_TEXT, "i");
  for (const t of ["Şartlar ve Koşullar", "Uslovi korišćenja", "Termeni și condiții", "利用規約", "Voorwaarden", "Términos y condiciones", "Vilkår", "Regler", "Умови використання", "User Agreement", "T & Cs", "Allgemeine Geschäftsbedingungen"]) assert.ok(re.test(t), t);
  for (const t of ["Oyun Kuralları", "Blackjack", "Slots", "Sport & Casino"]) assert.ok(!re.test(t), t);
  // rules-worded captions are clickable candidates, but a privacy policy or a game's rules is skipped
  for (const t of ["Pravila", "Szabályzat", "Kurallar", "条款"]) assert.ok(re.test(t), t);
  const skip = new RegExp(CLICK_SKIP, "i");
  for (const t of ["Adatvédelmi szabályzat", "Adatkezelési szabályzat", "Politika privatnosti", "Gizlilik Politikası", "Oyun Kuralları", "游戏规则", "隐私政策", "Spielregeln", "Pravila igre", "Pravila igara"]) assert.ok(skip.test(t), t);
  for (const t of ["Opšti uslovi", "Opći uvjeti igre", "Pravila igre na sreću", "Şartlar ve Koşullar", "Allgemeine Geschäftsbedingungen", "利用規約"]) assert.ok(!skip.test(t), t);
});

test("readLobby: an image-only link takes its caption from aria-label, then title, then the image's alt", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body><footer><p>${"Footer text. ".repeat(10)}</p>
      <a href="https://c.com/a" aria-label="Aria caption"><img src="data:," alt="Alt a"></a>
      <a href="https://c.com/b" title="Title caption"><img src="data:," alt="Alt b"></a>
      <a href="https://c.com/c"><img src="data:," alt="Uslovi korišćenja"></a>
      <a href="https://c.com/d"><img src="data:,"></a></footer></body></html>`);
    const lobby = await readLobby(page, { quietMs: 1500, maxMs: 4000 });
    const text = (h) => lobby.links.find((l) => l.href === h).text;
    assert.equal(text("https://c.com/a"), "Aria caption");
    assert.equal(text("https://c.com/b"), "Title caption");
    assert.equal(text("https://c.com/c"), "Uslovi korišćenja");
    assert.equal(text("https://c.com/d"), "");
  } finally { await browser.close(); }
});

// A sentence only the framed document holds: the page around the frame never says it.
const FRAMED = `<!doctype html><html><head><title>Terms and Conditions</title></head><body><h1>Terms and Conditions</h1><p>Only the framed document says this sentence about the governing law of Malta.</p>${Array.from({ length: 12 }, (_, i) => `<p>${i + 1}. ${GENERAL(i)}</p>`).join("")}</body></html>`;

test("a terms click that opens a new tab reads the tab and closes it (wildcasino.ag)", async () => {
  await withoutJev(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      // routed on the context: the tab the click opens is another page
      await site(page.context(), {
        "/": LOBBY(`<a href="#" onclick="window.open('/terms-popup.html')">Terms &amp; Conditions</a>`),
        "/terms-popup.html": TERMS_PAGE(),
      });
      await page.goto("https://casino.test/");
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }));
      assert.equal(r.href, "https://casino.test/terms-popup.html", r.tried.join(" | "));
      assert.equal(r.via, "click");
      assert.match(r.text, /These terms and conditions govern/);
      assert.equal(page.context().pages().length, 1, "the tab is closed");
    } finally { await browser.close(); }
  });
});

test("a terms click that shows a modal with an iframe reads the frame's document (slotmagie.de, rocket.run)", async () => {
  await withoutJev(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await site(page.context(), {
        "/": LOBBY(`<button onclick="document.getElementById('m').style.display = 'block'">Terms &amp; Conditions</button>`,
          `<div id="m" style="display:none"><iframe src="/terms-frame.html" width="800" height="600"></iframe></div>`),
        "/terms-frame.html": FRAMED,
      });
      await page.goto("https://casino.test/");
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }));
      assert.equal(r.via, "click", r.tried.join(" | "));
      assert.equal(r.frame, true);
      assert.equal(r.href, "https://casino.test/terms-frame.html");
      assert.match(r.text, /governing law of Malta/);
    } finally { await browser.close(); }
  });
});

test("a terms page whose body is an iframe is read from the frame", async () => {
  await withoutJev(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await site(page.context(), {
        "/": LOBBY(`<a href="/terms.html">Terms and Conditions</a>`),
        "/terms.html": `<!doctype html><html><head><title>Terms</title></head><body><h1>Terms</h1><p>${"Read our rules below. ".repeat(8)}</p><iframe src="/terms-doc.html" width="800" height="600"></iframe></body></html>`,
        "/terms-doc.html": FRAMED,
      });
      await page.goto("https://casino.test/");
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }));
      assert.equal(r.href, "https://casino.test/terms.html", r.tried.join(" | "));
      assert.equal(r.frame, true);
      assert.match(r.text, /governing law of Malta/);
    } finally { await browser.close(); }
  });
});

test("frameText: the longest frame that passes, never a PDF's frame", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const pages = { "/terms.pdf": FRAMED, "/short.html": "<html><body><p>Short.</p></body></html>", "/doc.html": FRAMED, "/longer.html": FRAMED.replace("</body>", `<p>${GENERAL(13)}</p></body>`) };
    await site(page, { ...pages, "/": `<html><body><iframe src="/terms.pdf"></iframe><iframe src="/short.html"></iframe></body></html>` });
    await page.goto("https://casino.test/");
    await page.waitForLoadState("load");
    assert.equal(await frameText(page, readsLikeTerms), null, "a .pdf frame is not read, a short frame does not count");
    await site(page, { ...pages, "/": `<html><body><iframe src="/doc.html"></iframe><iframe src="/longer.html"></iframe></body></html>` });
    await page.goto("https://casino.test/");
    await page.waitForLoadState("load");
    const f = await frameText(page, readsLikeTerms);
    assert.equal(f.url, "https://casino.test/longer.html");
    assert.equal(await frameText(page, () => false), null, "want decides");
  } finally { await browser.close(); }
});

test("a terms click that opens a PDF in a new tab reads the PDF and closes the tab", async () => {
  await withoutJev(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage(), pdf = termsPdf();
      await page.context().route("https://casino.test/**", (r) => {
        const p = new URL(r.request().url()).pathname;
        if (p === "/terms.pdf") return r.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
        return p === "/" ? r.fulfill({ status: 200, contentType: "text/html", body: LOBBY(`<a href="#" onclick="window.open('/terms.pdf')">Terms &amp; Conditions</a>`) }) : r.abort("aborted");
      });
      await page.goto("https://casino.test/");
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }));
      assert.equal(r.pdf, true, r.tried.join(" | "));
      assert.equal(r.via, "click");
      assert.equal(r.href, "https://casino.test/terms.pdf");
      assert.match(r.text, /General Terms and Conditions/);
      assert.equal(page.context().pages().length, 1, "the tab is closed");
    } finally { await browser.close(); }
  });
});

// A lobby whose chrome reads like terms (HEADER's menu, ELARA_SEO in the footer) and whose terms are reached only by a
// click: `clickable` is the footer's terms control.
const CLICK_CHROME = (clickable, main = `<p>${"Play slots and live games every day. ".repeat(30)}</p>`, end = "") => `<!doctype html><html><body>${HEADER}<main>${main}</main><footer>${clickable}${ELARA_SEO}</footer>${end}</body></html>`;
const POPUP_LINK = (url) => `<a href="#" onclick="window.open('${url}'); return false">Terms and Conditions</a>`;
// The search with the lobby's chrome reading like terms; `pages` adds routes on casino.test, `jev` is the Jev stand-in.
const searchClick = async (lobbyHtml, pages, jev = { notes: [] }, other = {}, chrome = true) => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await site(page.context(), { "/": lobbyHtml, ...pages });
    for (const [origin, routes] of Object.entries(other)) await page.context().route(`${origin}/**`, (r) => { const p = new URL(r.request().url()).pathname; return routes[p] ? r.fulfill({ status: 200, contentType: "text/html", body: routes[p] }) : r.abort("aborted"); });
    await page.goto("https://casino.test/");
    if (chrome) assert.ok(readsLikeTerms(await page.evaluate(() => document.body.innerText)), "the lobby's own chrome reads like terms");
    const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }), jev);
    return { ...r, tabs: page.context().pages().length };
  } finally { await browser.close(); }
};

test("a terms click whose tab shows the lobby's chrome for 6 s and then the terms reads the terms, not the chrome", async () => {
  const late = `<script>setTimeout(() => { document.querySelector("main").innerHTML = ${JSON.stringify(INTRO + GENERALS(12))}; }, 6000)</script>`;
  const lobbyHtml = CLICK_CHROME(POPUP_LINK("/terms-popup.html"));
  const r = await withoutJev(() => searchClick(lobbyHtml, { "/terms-popup.html": CLICK_CHROME(POPUP_LINK("/terms-popup.html"), "", late) }));
  assert.equal(r.href, "https://casino.test/terms-popup.html", r.tried.join(" | "));
  assert.equal(r.via, "click");
  assert.match(r.text, /12\. These terms and conditions govern/);
  assert.equal(r.tabs, 1, "the tab is closed");
});

test("a terms click whose tab is only the lobby's chrome is not the terms", async () => {
  const lobbyHtml = CLICK_CHROME(POPUP_LINK("/terms-popup.html"));
  const r = await withoutJev(() => searchClick(lobbyHtml, { "/terms-popup.html": lobbyHtml }));
  assert.equal(r.text, "", `accepted ${r.href} via ${r.via}`);
  assert.ok(r.tried.some((t) => /^click "Terms and Conditions" → https:\/\/casino\.test\/terms-popup\.html \(lobby shell\)$/.test(t)), r.tried.join(" | "));
  assert.equal(r.tabs, 1, "the tab is closed");
});

test("a terms click that navigates to a page that is only the lobby's chrome is not the terms", async () => {
  const lobbyHtml = CLICK_CHROME(`<span onclick="location.href = '/app/terms'">Terms and Conditions</span>`);
  const r = await withoutJev(() => searchClick(lobbyHtml, { "/app/terms": lobbyHtml }));
  assert.equal(r.text, "", `accepted ${r.href} via ${r.via}`);
  assert.ok(r.tried.includes('click "Terms and Conditions" (lobby shell)'), r.tried.join(" | "));
});

test("a terms click that opens a tab on another site is Jev's alone: no on Jev's no, yes on Jev's yes; a tab on the casino's own site is the pattern's", async () => {
  const other = { "https://help.other.test": { "/terms.html": TERMS_PAGE() } };
  const lobbyHtml = LOBBY(POPUP_LINK("https://help.other.test/terms.html"));
  const log = [];
  const no = await withJevKey(() => searchClick(lobbyHtml, {}, { notes: [], ask: fakeAsk({ accept: () => false, log }) }, other, false));
  assert.equal(no.text, "", `accepted ${no.href} via ${no.via}`);
  assert.ok(log.includes("page"), "Jev judged the tab");
  const yes = await withJevKey(() => searchClick(lobbyHtml, {}, { notes: [], ask: fakeAsk({ accept: () => true }) }, other, false));
  assert.equal(yes.href, "https://help.other.test/terms.html", yes.tried.join(" | "));
  assert.equal(yes.via, "click");
  const off = await withoutJev(() => searchClick(lobbyHtml, {}, { notes: [] }, other, false));
  assert.equal(off.text, "", `no key: accepted ${off.href} via ${off.via}`);
  // the same tab on the casino's own site is accepted on the pattern, whatever Jev says
  const own = await withJevKey(() => searchClick(LOBBY(POPUP_LINK("/terms.html")), { "/terms.html": TERMS_PAGE() }, { notes: [], ask: fakeAsk({ accept: () => false }) }, {}, false));
  assert.equal(own.href, "https://casino.test/terms.html", own.tried.join(" | "));
});

test("a Jev-only candidate is skipped while Jev is enabled but down, whether the footer question or the page question failed; without a key the pattern decides", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    // The general terms do not load, so the sportsbook's terms (a product-named link: Jev-only) are the next candidate.
    await site(page, { "/": LOBBY(ELARA_FOOTER), "/spotsbook-terms-and-conditions": TERMS_PAGE("Sportsbook Terms and Conditions") });
    const search = async (jev) => { await page.goto("https://casino.test/"); return fetchTerms(page, await readLobby(page, { quietMs: 2000 }), jev); };
    const down = await withJevKey(() => search({ notes: [], ask: async () => { throw new Error("jev http 529: overloaded"); } }));
    assert.equal(down.text, "", `Jev down: accepted ${down.href}`);
    const pageFails = async (state, questions) => { if (questions.is_terms) throw new Error("jev http 529: overloaded"); return fakeAsk()(state, questions); };
    const failed = await withJevKey(() => search({ notes: [], ask: pageFails }));
    assert.equal(failed.text, "", `Jev failed on the page: accepted ${failed.href}`);
    const off = await withoutJev(() => search({ notes: [] }));
    assert.equal(off.href, "https://casino.test/spotsbook-terms-and-conditions", off.tried.join(" | "));
  } finally { await browser.close(); }
});

test("a shell whose hidden text is the lobby's hidden SEO block plus 1,600 characters of other copy is not the terms", async () => {
  const copy = `<div hidden><p>${"Our live studio streams roulette and blackjack tables around the clock. ".repeat(23)}</p></div>`;
  assert.ok(copy.replace(/<[^>]+>/g, "").length >= 1600);
  const main = `<p>${"Play slots and live games every day. ".repeat(30)}</p>`;
  const r = await searchChrome(CHROME(main, HIDDEN_SEO + copy), CHROME(main, HIDDEN_SEO));
  assert.equal(r.text, "", `accepted ${r.href} via ${r.via}`);
  assert.ok(r.tried.includes("https://casino.test/terms.html (lobby shell)"), r.tried.join(" | "));
});

test("a guessed path whose hidden terms sit under a <div> menu the lobby also hides is the terms (the menu alone is not the lobby's hidden shell)", async () => {
  await withoutJev(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      const shell = (main) => `<!doctype html><html><body><header><button>Log in</button><button>Join now</button></header>${DIV_MENU}<main>${main}</main><footer><a href="/about">About us</a></footer></body></html>`;
      await site(page, { "/": shell(`<p>${"Play slots and live games every day. ".repeat(30)}</p>`), "/terms-and-conditions": shell(INTRO + `<div hidden>${GENERALS(14)}</div>`) });
      await page.goto("https://casino.test/");
      const r = await fetchTerms(page, await readLobby(page, { quietMs: 2000 }));
      assert.equal(r.href, "https://casino.test/terms-and-conditions", r.tried.join(" | "));
      assert.equal(r.via, "guess");
      assert.equal(r.hidden, true);
      assert.match(r.text, /14\. These terms and conditions govern/);
    } finally { await browser.close(); }
  });
});

test("otherDocsFor: the payments and KYC pages, none when Jev classified the lobby", () => {
  const lobby = { url: "https://x.com/", links: [{ href: "https://x.com/payments", text: "Payments" }, { href: "https://x.com/kyc", text: "KYC" }] };
  assert.deepEqual(otherDocsFor(lobby, { href: "", lobbyClass: null }).map((d) => d.kind), ["payments", "kyc"]);
  assert.deepEqual(otherDocsFor(lobby, { href: "https://x.com/payments", lobbyClass: null }).map((d) => d.kind), ["kyc"]);
  assert.deepEqual(otherDocsFor(lobby, { href: "", lobbyClass: "not_casino" }), []);
});
