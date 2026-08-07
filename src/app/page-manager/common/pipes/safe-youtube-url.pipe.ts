import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { CardComponentVideo } from '../models/editor/card.model';

@Pipe({
    name: 'safeYoutubeUrl',
    standalone: false
})
export class SafeYoutubeUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  private embedUrl = 'https://www.youtube.com/embed/';

  transform(video: CardComponentVideo) {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.embedUrl + video.url + (video.autoplay == true? '?autoplay=1' : ''));
  }
}
