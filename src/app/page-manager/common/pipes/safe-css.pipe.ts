import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

@Pipe({
  name: 'safeCssUrl'
})
export class SafeCssPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(htmlVal) {
    return this.sanitizer.bypassSecurityTrustStyle(htmlVal);
  }
}
