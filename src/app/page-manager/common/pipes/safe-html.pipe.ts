import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import DOMPurify from 'dompurify';

@Pipe({
    name: 'safeHTMLUrl',
    standalone: false
})
export class SafeHTMLPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(htmlVal) {
    // Strip dangerous markup (script tags, inline event handlers, javascript:
    // URLs, etc.) before trusting the result - htmlVal ultimately comes from
    // stored Firestore content, not just admin-authored input.
    const clean = DOMPurify.sanitize(htmlVal ?? '');
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }
}
