import { test } from "node:test";
import assert from "node:assert/strict";
import { termsCandidates, otherDocs, regionalSites, isPdf } from "../src/links.mjs";

const L = (text, href, footer = false) => ({ text, href, footer });

test("NetBet: the footer's Terms link beats the promo banner's T&Cs link to the home page", () => {
  const links = [L("T&Cs apply.", "https://casino.netbet.com"), L("Find out more here.", "https://casino.netbet.com/help/terms-and-conditions/privacy"),
    L("Terms and conditions", "https://casino.netbet.com/help/terms-and-conditions/terms-conditions", true), L("Privacy Policy.", "https://casino.netbet.com/help/terms-and-conditions/privacy", true)];
  assert.equal(termsCandidates(links, "https://casino.netbet.com/")[0].href, "https://casino.netbet.com/help/terms-and-conditions/terms-conditions");
});

test("Videoslots: a promotion's Terms & Conditions link ranks below the real terms page", () => {
  const links = [L("Terms & Conditions", "https://www.videoslots.com/free-spins/"), L("Terms & Conditions", "https://www.videoslots.com/terms-and-conditions/", true)];
  assert.equal(termsCandidates(links, "https://www.videoslots.com/")[0].href, "https://www.videoslots.com/terms-and-conditions/");
});

test("promotion terms pages rank below general terms, and alone they still qualify", () => {
  const promo = [L("Terms", "https://www.leovegas.com/en-row/promotions/terms"), L("Terms and Conditions", "https://www.leovegas.com/en-row/terms-and-conditions/", true)];
  assert.equal(termsCandidates(promo, "https://www.leovegas.com/en-row/")[0].href, "https://www.leovegas.com/en-row/terms-and-conditions/");
  const only = [L("Full T&Cs", "https://www.777.com/promotions/registration-offer/#tc")];
  assert.equal(termsCandidates(only, "https://www.777.com/")[0].href, "https://www.777.com/promotions/registration-offer/#tc");
});

test("BitStarz: /terms beats /bonus-terms-and-conditions; privacy, rules and other domains are never terms", () => {
  const links = [L("bonuses page", "https://www.bitstarz.com/bonus-terms-and-conditions"), L("terms", "https://www.bitstarz.com/terms", true),
    L("Privacy Policy", "https://www.bitstarz.com/privacy-policy", true), L("Sports rules", "https://www.bitstarz.com/sports-rules", true), L("Terms", "https://www.gamblingauthority.cw/terms")];
  const c = termsCandidates(links, "https://www.bitstarz.com/");
  assert.deepEqual(c.map((l) => l.href), ["https://www.bitstarz.com/terms", "https://www.bitstarz.com/bonus-terms-and-conditions"]);
});

test("777: a User Agreement under a privacy directory is the terms; the privacy policy next to it is not", () => {
  const links = [L("T&Cs Apply", "https://www.777.com/promotions/registration-offer/#tc", true), L("User Agreement", "https://www.777.com/security-and-privacy/user-agreement/", true), L("Privacy Policy", "https://www.777.com/security-and-privacy/privacy-policy/", true), L("Terms and conditions", "https://casino.netbet.com/help/terms-and-conditions/privacy", true)];
  assert.deepEqual(termsCandidates(links, "https://www.777.com/").map((l) => l.href), ["https://www.777.com/security-and-privacy/user-agreement/", "https://www.777.com/promotions/registration-offer/#tc"]);
});

test("home-page, hash-only and javascript hrefs are not candidates; subdomains of the casino are", () => {
  const links = [L("Terms", "https://bspin.io/"), L("Terms", "https://bspin.io/#"), L("Terms", "javascript:void(0)"), L("Terms of Service", "https://docs.bspin.io/terms", true)];
  assert.deepEqual(termsCandidates(links, "https://bspin.io/").map((l) => l.href), ["https://docs.bspin.io/terms"]);
});

test("non-English terms links qualify", () => {
  const links = [L("Termos e Condições", "https://www.lebull.pt/termos", true), L("AGB", "https://www.casino.de/agb", true)];
  assert.equal(termsCandidates(links, "https://www.lebull.pt/").length, 1);
  assert.equal(termsCandidates(links, "https://www.casino.de/").length, 1);
});

test("otherDocs picks the casino's own payments and KYC pages and skips taken URLs", () => {
  const links = [L("Payments", "https://slot.win/help-center/payments"), L("AML", "https://slot.win/help-center/aml"), L("KYC", "https://www.mga.org.mt/kyc")];
  assert.deepEqual(otherDocs(links, "https://slot.win/", ["https://slot.win/help-center/payments"]), [{ kind: "kyc", href: "https://slot.win/help-center/aml" }]);
});

test("regionalSites lists the brand's other domains: the exit country's first, then English-language markets", () => {
  const links = [L("Sweden", "https://www.unibet.se/"), L("UK", "https://www.unibet.co.uk/"), L("Ireland", "https://www.unibet.ie/"), L("Help", "https://help.unibet.com/"), L("Kindred", "https://www.kindredgroup.com/")];
  assert.deepEqual(regionalSites(links, "https://www.unibet.com/", "ie"), ["https://www.unibet.ie/", "https://www.unibet.co.uk/", "https://www.unibet.se/"]);
  assert.deepEqual(regionalSites(links, "https://www.unibet.com/", "direct"), ["https://www.unibet.co.uk/", "https://www.unibet.ie/", "https://www.unibet.se/"]);
});

test("betico: a footer Terms link to a PDF on a file host qualifies; a regulator's /terms and a non-footer CDN link do not", () => {
  const pdf = "https://d2xmnpb6h303sl.cloudfront.net/static/navigation/terms_and_conditions.pdf";
  const links = [L("Terms of Service", pdf, true), L("Terms", "https://www.gamblingauthority.cw/terms", true), L("Terms of Service", "https://d2xmnpb6h303sl.cloudfront.net/other/terms.html")];
  assert.deepEqual(termsCandidates(links, "https://betico.pro/").map((l) => l.href), [pdf]);
});

test("an own-domain terms page still outranks an off-domain PDF", () => {
  const links = [L("Terms", "https://cdn.example-casino.com/docs/terms.pdf", true), L("Terms and Conditions", "https://www.example-casino.com/terms", true)];
  assert.equal(termsCandidates(links, "https://www.example-casino.com/")[0].href, "https://www.example-casino.com/terms");
});

test("isPdf", () => {
  assert.equal(isPdf("https://x.com/a/terms.pdf"), true);
  assert.equal(isPdf("https://x.com/a/terms.pdf?v=3"), true);
  assert.equal(isPdf("https://x.com/pdf/terms"), false);
});
