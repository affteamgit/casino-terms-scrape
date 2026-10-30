// Text of a PDF, for terms casinos serve as a file (betico.pro, dexsport, americanluck): the browser's PDF viewer
// exposes no page text, so the bytes are fetched and read here with pdf.js.
export async function pdfText(bytes, maxChars = 250000) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // The loading task is destroyed rather than the document: it also frees the parser when the bytes are not a PDF.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const lines = [];
    let n = 0;
    for (let i = 1; i <= doc.numPages && n < maxChars; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      let line = "", lastY = null;
      for (const it of content.items) {
        if (!("str" in it)) continue;
        const y = Math.round(it.transform[5]);
        if (lastY !== null && y !== lastY) { lines.push(line); line = ""; }
        line += (line && !line.endsWith(" ") ? " " : "") + it.str;
        if (it.hasEOL) { lines.push(line); line = ""; lastY = null; continue; }
        lastY = y;
        n += it.str.length;
      }
      lines.push(line, "");
    }
    return lines.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
  } finally { await task.destroy(); }
}
