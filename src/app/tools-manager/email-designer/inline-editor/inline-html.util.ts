import DOMPurify from 'dompurify';

// Normalizes the inline editor's output before it's stored on a block:
// email-safe tags only, no classes, no scripts. Everything the compiler
// later receives for text/heading/footer fragments has passed through here.
export function normalizeInlineHtml(html: string): string {
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'span', 'ol', 'ul', 'li'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style']
  });
}
