import { test } from "node:test";
import assert from "node:assert/strict";
import { termsCandidates, otherDocs, regionalSites, isPdf, docLinks, siblingGuesses, namedTermsPage } from "../src/links.mjs";

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
  const links = [L("Terms", "https://d1abc.cloudfront.net/docs/terms.pdf", true), L("Terms and Conditions", "https://www.example-casino.com/terms", true)];
  assert.equal(termsCandidates(links, "https://www.example-casino.com/")[0].href, "https://www.example-casino.com/terms");
});

test("isPdf", () => {
  assert.equal(isPdf("https://x.com/a/terms.pdf"), true);
  assert.equal(isPdf("https://x.com/a/terms.pdf?v=3"), true);
  assert.equal(isPdf("https://x.com/pdf/terms"), false);
});

test("an own-domain footer PDF keeps its full score", () => {
  const c = termsCandidates([L("Terms and Conditions", "https://www.example-casino.com/docs/terms.pdf", true)], "https://www.example-casino.com/");
  assert.equal(c.length, 1);
  assert.equal(c[0].score, 10);
});

test("Nordic link text and /rules: spinit2's \"Vilkår og betingelser\" is the terms; sports betting rules still are not", () => {
  const spin = termsCandidates([L("Vilkår og betingelser", "https://spinit2.com/no/rules", true)], "https://spinit2.com/no/");
  assert.deepEqual(spin.map((l) => l.href), ["https://spinit2.com/no/rules"]);
  assert.deepEqual(termsCandidates([L("Sports Betting Rules", "https://x.com/sports-rules", true)], "https://x.com/"), []);
  assert.equal(termsCandidates([L("Användarvillkor", "https://x.se/anvandarvillkor", true), L("Käyttöehdot", "https://x.fi/ehdot", true)], "https://x.se/").length, 1);
  assert.equal(termsCandidates([L("Käyttöehdot", "https://x.fi/info", true)], "https://x.fi/").length, 1);
});

test("docLinks: a thin terms page's link to its document; privacy PDFs and other domains' PDFs are not chosen", () => {
  const page = "https://clubscasino.com/terms-of-use/";
  const pdf = "https://clubscasino.com/wp-content/uploads/2026/07/KHK-Games-Clubs-Poker-Terms-of-Use-06_30_2026.pdf";
  const links = [L("Home", "https://clubscasino.com/"), L("Games", "https://clubscasino.com/games/"), L("Privacy Policy", "https://clubscasino.com/wp-content/uploads/2026/07/Privacy-Policy.pdf"),
    L("Download", pdf), L("Terms of Use", page), L("Terms", "https://regulator.gov/terms.pdf"), L("Contact", "mailto:support@clubscasino.com")];
  assert.deepEqual(docLinks(links, page).map((l) => l.href), [pdf]);
  assert.deepEqual(docLinks([L("Terms of Use", "https://other.com/terms-of-use.pdf"), L("Download", "https://other.com/x")], page), [], "an off-domain PDF is not the casino's");
  assert.deepEqual(docLinks([L("Download", "https://d1abc.cloudfront.net/legal/terms.pdf")], page).map((l) => l.href), ["https://d1abc.cloudfront.net/legal/terms.pdf"], "a file host is");
  assert.deepEqual(docLinks([L("View document", "https://clubscasino.com/wp-content/uploads/2026/terms-of-use"), L("Read more", "https://clubscasino.com/blog/win-big"), L("Open", "https://clubscasino.com/legal/doc-7")], page).map((l) => l.href),
    ["https://clubscasino.com/wp-content/uploads/2026/terms-of-use"], "a bare verb needs a document-shaped target: Read more -> a blog post is not chosen");
  assert.deepEqual(docLinks([L("Download", "https://clubscasino.com/files/t.docx")], page).length, 1);
  assert.deepEqual(docLinks([L("Terms of Use", "https://evilclubscasino.com/terms.pdf"), L("Download", "https://evilclubscasino.com/uploads/t.pdf")], page), [], "a lookalike domain is not the casino");
  assert.equal(docLinks([L("Download", "https://cdn.clubscasino.com/t.pdf")], page).length, 1, "a subdomain is");
  assert.deepEqual(docLinks([L("View", "https://clubscasino.com/profiles/me"), L("Open", "https://clubscasino.com/social-media-x"), L("Read", "https://clubscasino.com/wp-content/media/terms")], page).map((l) => l.href), ["https://clubscasino.com/wp-content/media/terms"], "document-path words are whole path segments");
  assert.equal(docLinks(Array.from({ length: 6 }, (_, i) => L("Download", `https://clubscasino.com/f${i}.pdf`)), page).length, 2, "two at most");
});

test("horseshoe: a link whose own path names the terms is a candidate whatever its caption says", () => {
  const page = "https://www.horseshoeonlinecasino.com/";
  const links = [L("Privacy Policy", "https://www.horseshoeonlinecasino.com/support/terms-and-conditions", true), L("Privacy Policy", "https://www.horseshoeonlinecasino.com/support/privacy-policy", true)];
  const c = termsCandidates(links, page);
  assert.deepEqual(c.map((l) => l.href), ["https://www.horseshoeonlinecasino.com/support/terms-and-conditions"]);
  assert.equal(c[0].score, 5 + 2 + 1, "a path hit in the footer, named as the terms: the caption adds nothing");
  // the caption still cannot make a privacy page the terms
  assert.deepEqual(termsCandidates([L("Terms", "https://x.com/privacy-policy", true)], "https://x.com/"), []);
  // a privacy page under a terms directory is still privacy (NetBet)
  assert.deepEqual(termsCandidates([L("Privacy Policy", "https://x.com/help/terms-and-conditions/privacy", true)], "https://x.com/"), []);
  // a strong word elsewhere in the path is not enough: the page's own name decides
  assert.deepEqual(termsCandidates([L("Cookie Policy", "https://x.com/terms-of-use/cookies", true)], "https://x.com/"), []);
  for (const p of ["terms-of-service", "terms-of-use", "termsandconditions", "user-agreement", "general-terms"]) assert.equal(termsCandidates([L("Privacy", `https://x.com/${p}`, true)], "https://x.com/").length, 1, p);
});

test("siblingGuesses: virginbet's only legal link is /dl/cookiepolicy, so the terms are guessed next to it", () => {
  const page = "https://www.virginbet.co.za/";
  const links = [L("Click here for our Cookie Policy", "https://www.virginbet.co.za/dl/cookiepolicy"), L("Slots", "https://www.virginbet.co.za/casino/slots"),
    L("Privacy", "https://www.virginbet.co.za/dl/privacy?x=1"), L("Responsible Gambling", "https://www.virginbet.co.za/help/safer-gambling", true)];
  assert.deepEqual(siblingGuesses(links, page), [
    "https://www.virginbet.co.za/dl/terms", "https://www.virginbet.co.za/dl/terms-and-conditions", "https://www.virginbet.co.za/dl/termsandconditions",
    "https://www.virginbet.co.za/dl/terms-of-use", "https://www.virginbet.co.za/dl/terms-of-service", "https://www.virginbet.co.za/dl/general-terms",
    "https://www.virginbet.co.za/help/terms", "https://www.virginbet.co.za/help/terms-and-conditions", "https://www.virginbet.co.za/help/termsandconditions",
    "https://www.virginbet.co.za/help/terms-of-use", "https://www.virginbet.co.za/help/terms-of-service", "https://www.virginbet.co.za/help/general-terms"]);
  // one segment, a bare language directory (the regular guesses cover those), another domain, or a non-legal link: nothing
  assert.deepEqual(siblingGuesses([L("Privacy Policy", "https://x.com/privacy-policy"), L("Privacy Policy", "https://x.com/en/privacy-policy"), L("Cookies", "https://other.com/legal/cookies"), L("Games", "https://x.com/casino/games")], "https://x.com/"), []);
  // at most two directories
  assert.equal(siblingGuesses([L("Privacy", "https://x.com/a/privacy"), L("Cookies", "https://x.com/b/cookies"), L("Responsible gaming", "https://x.com/c/rg")], "https://x.com/").length, 12);
});

test("namedTermsPage: an own-domain page whose own name is the general terms (beef.casino's 'MEHR LESEN' link)", () => {
  const page = "https://beef.casino/de/terms-use-site";
  assert.equal(namedTermsPage("https://beef.casino/de/terms-and-conditions", page), true);
  assert.equal(namedTermsPage("https://www.beef.casino/terms-of-service?x=1", page), true);
  assert.equal(namedTermsPage("https://fugu.casino/de/terms-conditions", "https://fugu.casino/de/terms-use-site"), true, "fugu's slug");
  assert.equal(namedTermsPage("https://beef.casino/de/privacy-policy", page), false);
  assert.equal(namedTermsPage("https://beef.casino/de/bonus-terms-and-conditions", page), false, "a bonus's terms");
  assert.equal(namedTermsPage("https://other.com/terms-and-conditions", page), false);
  assert.equal(namedTermsPage("https://beef.casino/terms-and-conditions/privacy", page), false);
});

test("the general terms outrank a product's terms and a bare /legal page, captioned or not", () => {
  const page = "https://x.com/";
  const links = [L("Poker Terms", "https://x.com/poker/terms", true), L("Sportsbook Terms", "https://x.com/sportsbook/terms", true), L("Terms", "https://x.com/legal", true),
    L("Terms and Conditions", "https://x.com/terms-and-conditions", true)];
  const c = termsCandidates(links, page);
  assert.equal(c[0].href, "https://x.com/terms-and-conditions");
  assert.ok(c[0].score > c.find((l) => /legal/.test(l.href)).score);
  assert.ok(c.find((l) => /poker/.test(l.href)).score < c.find((l) => /legal/.test(l.href)).score, "a product's terms rank below");
  // the caption still counts for a strong slug
  assert.ok(termsCandidates([L("Terms and Conditions", "https://x.com/terms-and-conditions", true)], page)[0].score > termsCandidates([L("Privacy Policy", "https://x.com/terms-and-conditions", true)], page)[0].score);
});

test("namedTermsPage: a promotion's, product's or VIP directory's terms are not the general terms", () => {
  const page = "https://x.com/de/terms-use-site";
  for (const p of ["promotions/terms-and-conditions", "vip/terms-conditions", "sportsbook/terms-and-conditions", "poker/general-terms", "casino-games/terms-and-conditions", "bonus/de/terms-of-use", "racing/terms-of-service", "privacy/terms-and-conditions"])
    assert.equal(namedTermsPage(`https://x.com/${p}`, page), false, p);
  for (const p of ["en/info/terms-and-conditions", "legal/terms-of-service", "de/terms-conditions"]) assert.equal(namedTermsPage(`https://x.com/${p}`, page), true, p);
});

test("a product named in the caption does not demote the general terms ('Casino & Sports Terms')", () => {
  const c = termsCandidates([L("Terms", "https://x.com/legal", true), L("Casino & Sports Terms", "https://x.com/terms-and-conditions", true)], "https://x.com/");
  assert.equal(c[0].href, "https://x.com/terms-and-conditions");
  assert.ok(c[0].score > c[1].score);
});

test("namedTermsPage: directory words are read whole, so /preferences and /permission are not a promotion", () => {
  const page = "https://x.com/";
  for (const p of ["preferences/terms-and-conditions", "permission/terms-of-use", "help_center/terms-and-conditions"]) assert.equal(namedTermsPage(`https://x.com/${p}`, page), true, p);
  for (const p of ["promotions/terms-and-conditions", "my_bonus/terms-of-use", "sports-rules/terms-and-conditions", "aml-policy/terms-and-conditions"]) assert.equal(namedTermsPage(`https://x.com/${p}`, page), false, p);
});
