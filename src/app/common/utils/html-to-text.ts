// Derives a plain-text alternative from an HTML email body for the `text`
// part of the `mail` doc, alongside `html`. The Firebase "Trigger Email"
// extension sends a proper multipart/alternative message when both are
// present - without a text/plain part at all, the message is HTML-only,
// which is exactly the shape spam filters (AT&T/BellSouth's Yahoo-backend
// ones especially) score against, independent of SPF/DKIM/DMARC passing.
export function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Turn block-level breaks into newlines before reading textContent, or
  // paragraphs/divs/list items all run together with no separation.
  doc.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach(el => {
    el.append('\n');
  });
  // Render links as "label (url)" so the destination survives losing the HTML.
  doc.querySelectorAll('a[href]').forEach(el => {
    const href = el.getAttribute('href');
    const label = el.textContent?.trim();
    if (href && label && href !== label) {
      el.replaceWith(`${label} (${href})`);
    }
  });

  const text = doc.body.textContent ?? '';

  return text
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
