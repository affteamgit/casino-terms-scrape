import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { dismissCookies, isParked, englishVariant, isParkedUrl, notCasino, sameAsLobby, fingerprint } from "../src/terms.mjs";

test("isParked: for-sale and parking pages, not a casino that merely mentions a domain", () => {
  assert.equal(isParked("Skip to main content Excellent 4.5 out of 5 The domain name ScatterHall.com is for sale! Get this domain Own it today for $2,995, or make an offer."), true);
  assert.equal(isParked("English Copyright © 2026 GoDaddy Operating Company, LLC. Alle Rechte vorbehalten."), true);
  assert.equal(isParked("The domain name ScatterHall.com is for sale!"), true);
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
