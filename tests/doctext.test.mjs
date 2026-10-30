import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { hiddenTextInPage, preferHidden } from "../src/doctext.mjs";

test("preferHidden: only a hidden text that is long and much longer than the visible one", () => {
  assert.equal(preferHidden("x".repeat(1000), "y".repeat(3000)), true);
  assert.equal(preferHidden("x".repeat(1000), "y".repeat(2500)), false); // not 3x
  assert.equal(preferHidden("x".repeat(100), "y".repeat(1500)), false); // under 2,000
});

// SoftSwiss "/rules": section headings visible, the sections themselves display:none until clicked.
const clause = (n) => `<p><span>${n}.1</span> Please read these General Terms and Conditions prior to using our website. ${"These Terms govern every bet placed and every withdrawal requested. ".repeat(15)}</p>`;
const FIXTURE = `<!doctype html><html><head><style>.panel{display:none}</style></head><body>
<header><nav><a href="/">Lobby</a><a href="/promo">Promotions</a></nav></header>
<article class="info-article"><h1>General Terms and Conditions</h1><p>Version 1.8</p>
${[1, 2, 3, 4, 5].map((n) => `<div><h2>Section ${n}</h2><div class="panel">${clause(n)}</div></div>`).join("")}
</article>
<footer><a href="/privacy">Privacy</a><a href="/rules">Terms and Conditions</a><script>var x = "script text must not leak";</script></footer>
</body></html>`;

test("hiddenTextInPage returns the collapsed sections, without nav, footer or scripts", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    const visible = await page.evaluate(() => document.body.innerText);
    const hidden = await page.evaluate(hiddenTextInPage);
    assert.ok(visible.length < 300, `visible text is only the headings: ${visible.length}`);
    assert.ok(hidden.length > 4000, `hidden text holds the sections: ${hidden.length}`);
    assert.match(hidden, /3\.1 Please read these General Terms/);
    assert.doesNotMatch(hidden, /script text must not leak|Promotions|Privacy/);
    assert.match(hidden, /Section 2\n/); // block elements end a line
    assert.equal(preferHidden(visible, hidden), true);
  } finally { await browser.close(); }
});
