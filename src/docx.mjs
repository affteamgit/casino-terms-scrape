// Text of a Word document (.docx), for terms casinos publish only as one (ecasino.cz's "Všeobecné obchodní podmínky").
// A DOCX is a ZIP holding XML; the body is word/document.xml. The ZIP is read here without a dependency: the end record,
// the central directory, then the one entry's local header; stored (0) or deflated (8) entries. Not handled: ZIP64,
// encryption, archives split over several disks. Anything unreadable throws, as pdfText rejects what is not a PDF.
import { inflateRawSync } from "node:zlib";

function zipEntry(buf, wanted) {
  // The end-of-central-directory record: 22 bytes plus a comment of up to 65,535, at the end of the file.
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("not a zip: no end of central directory");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip: bad central directory");
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen), local = buf.readUInt32LE(p + 42);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name !== wanted) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error("zip: bad local header");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + size > buf.length) throw new Error("zip: truncated entry");
    const data = buf.subarray(start, start + size);
    if (method === 0) return data;
    if (method === 8) return inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 }); // a zip bomb stops at 64 MB
    throw new Error(`zip: compression method ${method}`);
  }
  throw new Error(`docx: no ${wanted}`);
}

const ENTITIES = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
const codePoint = (m, n) => { try { return String.fromCodePoint(n); } catch { return m; } };
/**
 * The document's text: one line per paragraph, tabs as spaces, the five XML entities and numeric character references
 * decoded, whitespace collapsed. A field's code (<w:instrText>: ' HYPERLINK "…" ') and a tracked deletion (<w:delText>)
 * are not the document's text.
 */
export function docxText(bytes, maxChars = 250000) {
  const xml = zipEntry(Buffer.from(bytes), "word/document.xml").toString("utf8");
  return xml.replace(/<w:(instrText|delText)\b[^>]*>[\s\S]*?<\/w:\1>/g, "")
    .replace(/<\/w:p>|<w:br\s*\/>|<w:cr\s*\/>/g, "\n").replace(/<w:tab\s*\/>/g, " ").replace(/<[^>]*>/g, "")
    .replace(/&(?:(lt|gt|quot|apos|amp)|#(\d+)|#x([0-9a-f]+));/gi, (m, e, d, x) => (e ? ENTITIES[e] : codePoint(m, d ? Number(d) : parseInt(x, 16))))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").slice(0, maxChars);
}
