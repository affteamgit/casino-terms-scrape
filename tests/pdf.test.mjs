import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfText } from "../src/pdf.mjs";

// A one-page PDF with a correct cross-reference table, built here so the test needs no fixture file.
function tinyPdf(lines) {
  const stream = `BT /F1 12 Tf 20 120 Td 14 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 160] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("pdfText reads the lines of a PDF in order", async () => {
  const text = await pdfText(tinyPdf(["General Terms and Conditions", "1.1 These terms apply to every player.", "1.2 Withdrawals are processed within 24 hours."]));
  assert.match(text, /General Terms and Conditions\s+1\.1 These terms apply to every player\.\s+1\.2 Withdrawals/);
});

test("pdfText caps the text", async () => {
  const text = await pdfText(tinyPdf(["x".repeat(200)]), 50);
  assert.equal(text.length, 50);
});

test("pdfText rejects what is not a PDF", async () => {
  await assert.rejects(pdfText(Buffer.from("<html>not a pdf</html>")));
});
