// Text a page holds but does not show. Single-page casinos lay their terms out as an accordion (SoftSwiss "/rules"):
// innerText is the section headings, while the sections sit in the DOM hidden by CSS. textContent reads them.
export const MIN_HIDDEN = 2000;

/** Runs inside the page (page.evaluate): body textContent minus scripts, styles and the page chrome, one block per line. */
export function hiddenTextInPage() {
  const root = document.body.cloneNode(true);
  for (const el of root.querySelectorAll("script, style, noscript, template, svg, header, nav, footer")) el.remove();
  const BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|TR|TD|TH|SECTION|ARTICLE|BR|TABLE|DD|DT|DL|BLOCKQUOTE|PRE|DETAILS|SUMMARY)$/;
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) { out.push(n.nodeValue); return; }
    if (n.nodeType !== 1) return;
    const block = BLOCK.test(n.tagName);
    if (block) out.push("\n");
    for (const c of n.childNodes) walk(c);
    if (block) out.push("\n");
  };
  walk(root);
  return out.join("").replace(/[ \t \r]+/g, " ").replace(/ *\n[ \n]*/g, "\n").trim();
}

/** The hidden text replaces the visible one only when it is a document in its own right, not a few more labels. */
export function preferHidden(visible, hidden) {
  return hidden.length >= MIN_HIDDEN && hidden.length >= 3 * visible.length;
}
