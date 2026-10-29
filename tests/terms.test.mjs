import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { dismissCookies, isParked } from "../src/terms.mjs";

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
