import { test } from "node:test";
import assert from "node:assert/strict";
import { docxText } from "../src/docx.mjs";
import { zip, docx, CONTENT_TYPES } from "./docx-fixture.mjs";

test("docxText reads the paragraphs of a DOCX, deflated or stored, one per line", () => {
  const paras = ["Všeobecné obchodní podmínky", "1.1 These terms apply to every player.", "1.2 Withdrawals are processed within 24 hours."];
  for (const method of [8, 0]) assert.equal(docxText(docx(paras, method)), paras.join("\n"), `method ${method}`);
});

test("docxText: tabs and breaks are spaces and lines, the five XML entities are decoded, runs of whitespace collapse", () => {
  const body = `Terms<w:tab/>&amp; Conditions &lt;v2&gt;   &quot;Player&quot; &apos;s</w:t></w:r><w:r><w:br/><w:t>second line`;
  assert.equal(docxText(docx([body])), `Terms & Conditions <v2> "Player" 's\nsecond line`);
});

test("docxText caps the text", () => {
  assert.equal(docxText(docx(["x".repeat(200)]), 50).length, 50);
});

// A corrupt file throws, as pdfText rejects what is not a PDF: the caller notes it as unreadable.
test("docxText throws on what is not a DOCX", () => {
  assert.throws(() => docxText(Buffer.from("<html>not a docx</html>")));
  assert.throws(() => docxText(zip({ "[Content_Types].xml": CONTENT_TYPES })), /word\/document\.xml/);
  assert.throws(() => docxText(docx(["Terms"]).subarray(0, 40)));
});
