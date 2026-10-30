import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { dismissCookies, isParked, englishVariant, isParkedUrl, notCasino, sameAsLobby, fingerprint, guessUrls, GUESS_PATHS, readLobby, readDoc, readsLikeTerms, expandSections, marketplaceLobby, isMarketplaceUrl, lobbyStatus, addedText, sitemapChildren, sitemapTerms, fetchTerms, fastInPlace, guessOrder, isShellOf } from "../src/terms.mjs";

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
    const lobby = await readLobby(page, { quietMs: 2000 });
    const r = await fetchTerms(page, lobby);
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

test("a promotion's terms link is not fast-accepted when Jev can judge it; without Jev, or when Jev fails, the pattern decides as before", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await site(page, { "/": LOBBY("", `<a href="/bonus-terms">Bonus Terms</a>`), "/bonus-terms": PROMO_TERMS_PAGE });
    const search = async (jev) => { await page.goto("https://casino.test/"); return fetchTerms(page, await readLobby(page, { quietMs: 2000 }), jev); };
    const off = await withoutJev(() => search({ notes: [] }));
    assert.equal(off.via, "promo-terms", off.tried.join(" | "));
    const log = [];
    const no = await withJevKey(() => search({ notes: [], ask: fakeAsk({ accept: () => false, log }) }));
    assert.equal(no.text, "", `accepted ${no.href}`);
    assert.ok(log.includes("page"), "Jev judged the page");
    const failing = async (state, questions) => { if (questions.is_terms) throw new Error("boom"); return fakeAsk()(state, questions); };
    const down = await withJevKey(() => search({ notes: [], ask: failing }));
    assert.equal(down.via, "promo-terms", down.tried.join(" | "));
  } finally { await browser.close(); }
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

test("isShellOf: the lobby's own text, or its opening with no more terms words than the lobby; a page that only shares its header is not", () => {
  const header = "Casino Live Sports Promotions VIP Login Register ".repeat(8), grid = "Spin the reels and win big today. ".repeat(80);
  const footer = " Terms and Conditions. Privacy Policy. Responsible Gaming. Licensed and regulated.";
  const lobby = (header + grid + footer).trim();
  const ref = { len: lobby.length, fp: fingerprint(lobby) };
  assert.equal(isShellOf(lobby, ref, lobby), true, "the same text");
  assert.equal(isShellOf(lobby.slice(0, 2000) + " a ticker".repeat(30), ref, lobby), true, "the same first 2,000 characters");
  assert.equal(isShellOf(lobby.slice(0, 300) + "x".repeat(Math.round(lobby.length * 0.08)) + lobby.slice(300), ref, lobby), true, "same opening, 8% longer");
  assert.equal(isShellOf(lobby.slice(0, 300) + " General Terms and Conditions ".repeat(Math.ceil(lobby.length * 2 / 30)), ref, lobby), false, "same header, three times as long");
  assert.equal(isShellOf("x".repeat(lobby.length), ref, lobby), false, "same length, another opening");
  assert.equal(isShellOf("anything", { len: 0, fp: "" }, ""), false, "no lobby text");
  const terms = " These terms and conditions govern your account and the agreement with the operator.";
  const near = lobby.slice(0, 300) + terms.repeat(Math.ceil((lobby.length * 1.05 - 300) / terms.length));
  assert.ok(Math.abs(near.length - lobby.length * 1.05) < terms.length);
  assert.equal(isShellOf(near, ref, lobby), false, "a terms page under the lobby's header at 1.05 times its length");
  assert.equal(isShellOf((header + grid.slice(0, grid.length / 2) + "Page not found." + footer).trim(), ref, lobby), true, "a 404 shell: the header, half the grid and the footer");
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
