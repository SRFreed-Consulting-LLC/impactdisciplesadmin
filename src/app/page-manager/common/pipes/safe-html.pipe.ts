import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

@Pipe({
    name: 'safeHTMLUrl',
    standalone: false
})
export class SafeHTMLPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(htmlVal) {
    return this.sanitizer.bypassSecurityTrustHtml(htmlVal);
  }
}
