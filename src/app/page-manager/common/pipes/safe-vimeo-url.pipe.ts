import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { CardComponentVideo } from '../models/editor/card.model';

@Pipe({
    name: 'safeVimeoUrl',
    standalone: false
})
export class SafeVimeoUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  private embedUrl = 'https://player.vimeo.com/video/';

  transform(video:CardComponentVideo) {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.embedUrl + video.url + (video.autoplay == true? '?autoplay=1' : ''));
  }
}
