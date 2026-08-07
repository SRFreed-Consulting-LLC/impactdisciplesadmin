import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Video } from '../models/ui/video.model';

@Pipe({
    name: 'safeVideoYoutubeUrlPipe',
    standalone: false
})
export class SafeVideoYoutubeUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  private embedUrl = 'https://www.youtube.com/embed/';

  transform(video: Video) {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.embedUrl + video.video_id);
  }
}
