import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { dismissCookies, isParked, englishVariant, isParkedUrl, notCasino, sameAsLobby, fingerprint, guessUrls, GUESS_PATHS, readLobby } from "../src/terms.mjs";

test("isParked: for-sale and parking pages, not a casino that merely mentions a domain", () => {
  assert.equal(isParked("Skip to main content Excellent 4.5 out of 5 The domain name ScatterHall.com is for sale! Get this domain Own it today for $2,995, or make an offer."), true);
  assert.equal(isParked("English Copyright © 2026 GoDaddy Operating Company, LLC. Alle Rechte vorbehalten."), true);
  assert.equal(isParked("The domain name ScatterHall.com is for sale!"), true);
  assert.equal(isParked("Secured by GoDaddy. Play slots here. Licensed in Curacao. 18+ Gamble responsibly."), false, "an SSL seal is not a parked page");
  assert.equal(isParked("Welcome. Our partners: jordan.com and sudan.com. Play slots and live games here."), false, "dan.com inside another word");
  assert.equal(isParked("Listed at dan.com. Contact the owner."), true);
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
