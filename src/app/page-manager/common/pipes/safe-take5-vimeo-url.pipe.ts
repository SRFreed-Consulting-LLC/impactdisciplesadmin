import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Video } from '../models/ui/video.model';

@Pipe({
    name: 'safeVideoVimeoUrlPipe',
    standalone: false
})
export class SafeVideoVimeoUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  private embedUrl = 'https://player.vimeo.com/video/';

  transform(video: Video) {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.embedUrl + video.video_id);
  }
}
