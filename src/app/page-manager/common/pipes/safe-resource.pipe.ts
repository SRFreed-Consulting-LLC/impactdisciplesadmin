import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

@Pipe({
    name: 'safeResourceUrl',
    standalone: false
})
export class SafeResourcePipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(htmlVal) {
    return this.sanitizer.bypassSecurityTrustResourceUrl(htmlVal);
  }
}
