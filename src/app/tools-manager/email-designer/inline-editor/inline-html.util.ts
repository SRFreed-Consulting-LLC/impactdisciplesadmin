import DOMPurify from 'dompurify';

// Normalizes the inline editor's output before it's stored on a block:
// email-safe tags only, no classes, no scripts. Everything the compiler
// later receives for text/heading/footer fragments has passed through here.
//
// The whitelist is broader than what the inline toolbar can PRODUCE
// (headings, images, blockquotes) because legacy Quill-authored templates
// are imported into the designer as one text block - clicking into one to
// edit must not strip the content the old editor legitimately created
// (h1-h6, base64 <img>, blockquote, alignment/color styles).
export function normalizeInlineHtml(html: string): string {
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'a', 'span', 'div',
      'ol', 'ul', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'pre', 'img'
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'src', 'alt', 'width', 'height', 'class']
  });
}
