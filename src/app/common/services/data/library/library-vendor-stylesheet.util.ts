// Ported verbatim from impact-discipleship-library-manager-new's
// core/services/vendor-stylesheet.util.ts - injects a <link rel="stylesheet">
// for a vendor CSS asset the first time it's actually needed (Form.io's
// builder/renderer needs bootstrap.min.css + formio.full.min.css), rather
// than loading them app-wide. Idempotent. See angular.json's `assets` array
// for where these files get copied to the build output root.
export function ensureLibraryVendorStylesheet(href: string): void {
  if (document.querySelector(`link[data-vendor-stylesheet="${href}"]`)) {
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset['vendorStylesheet'] = href;
  document.head.appendChild(link);
}
