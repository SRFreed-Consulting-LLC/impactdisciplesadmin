import Quill from 'quill';

// Registered ONCE, app-wide: swap Quill's class-based attributors for
// their inline-STYLE twins so size/color/highlight/alignment emit
// `style="..."` (what email clients and [innerHTML]-rendered surfaces
// need) instead of ql-* classes (which need Quill's stylesheet to mean
// anything). NOTE this is a GLOBAL Quill config, deliberately accepted
// (email designer P1 decision): inline-styled output is strictly MORE
// portable for the public site/emails that render it, and existing stored
// content with ql-* classes still renders fine inside Quill itself.
// Callers: the email designer's inline text editor and the campaign
// popup editor (whose html is [innerHTML]-rendered by the storefront).
export const QUILL_SIZE_WHITELIST = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'];
let styleAttributorsRegistered = false;

export function registerQuillStyleAttributors(): void {
  if (styleAttributorsRegistered) {
    return;
  }
  styleAttributorsRegistered = true;
  const size = Quill.import('attributors/style/size') as { whitelist: string[] };
  size.whitelist = QUILL_SIZE_WHITELIST;
  Quill.register(size as never, true);
  Quill.register(Quill.import('attributors/style/color') as never, true);
  Quill.register(Quill.import('attributors/style/background') as never, true);
  Quill.register(Quill.import('attributors/style/align') as never, true);
}
