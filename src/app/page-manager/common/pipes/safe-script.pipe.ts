import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

@Pipe({
    name: 'safeScriptUrl',
    standalone: false
})
export class SafeScriptPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(htmlVal) {
    return this.sanitizer.bypassSecurityTrustScript(htmlVal);
  }
}
