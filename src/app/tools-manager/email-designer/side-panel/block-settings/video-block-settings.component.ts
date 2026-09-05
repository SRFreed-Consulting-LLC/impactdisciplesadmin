import { Component, Input } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { VideoBlock } from 'src/app/common/models/admin/email-design.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { parseVideoUrl, vimeoOembedUrl } from '../../video-url.util';
import { DesignerStateService } from '../../designer-state.service';

// Settings editor for a video block - extracted from
// DesignerSidePanelComponent 2026-09-05 (review item 3). Same shape as the
// other block editors, plus two things only this one needs: HttpClient for
// Vimeo's oEmbed thumbnail lookup, and its OWN image picker for a custom
// thumbnail (the panel used to share one picker between image blocks and
// this, juggling two targets - see ImageBlockSettingsComponent).
//
// URL entry drives everything: parse provider/id, auto-thumbnail for
// YouTube, async oEmbed thumbnail for Vimeo, manual for anything else
// (matching Mailchimp's video block behavior).
@Component({
    selector: 'app-video-block-settings',
    templateUrl: './video-block-settings.component.html',
    styleUrls: ['./video-block-settings.component.scss'],
    standalone: false
})
export class VideoBlockSettingsComponent {
  @Input() block!: VideoBlock;

  readonly pickerVisible$ = new BehaviorSubject<boolean>(false);
  pickerCard: { image?: ImageModel } = {};

  constructor(private state: DesignerStateService, private http: HttpClient) {}

  commit(mutate: () => void): void {
    this.state.commit(mutate);
  }

  onUrlChange(url: string): void {
    const video = this.block;
    const parsed = parseVideoUrl(url);
    this.state.commit(() => {
      video.props.url = url.trim();
      video.props.provider = parsed.provider;
      video.props.videoId = parsed.videoId;
      if (!video.props.customThumbnail) {
        video.props.thumbnailUrl = parsed.thumbnailUrl;
      }
    });
    if (parsed.provider === 'vimeo' && !video.props.customThumbnail) {
      this.http.get<{ thumbnail_url?: string }>(vimeoOembedUrl(url)).subscribe({
        next: (response) => {
          if (response?.thumbnail_url) {
            this.state.commit(() => {
              video.props.thumbnailUrl = response.thumbnail_url!;
            });
          }
        },
        // Private/unlisted videos or a network hiccup: leave the thumbnail
        // empty, the author can set one manually.
        error: () => undefined
      });
    }
  }

  setCaption(caption: string): () => void {
    return () => {
      this.block.props.caption = caption;
    };
  }

  useSourceThumbnail(): void {
    const video = this.block;
    const parsed = parseVideoUrl(video.props.url);
    this.state.commit(() => {
      video.props.customThumbnail = false;
      video.props.thumbnailUrl = parsed.thumbnailUrl;
    });
    if (parsed.provider === 'vimeo') {
      this.onUrlChange(video.props.url);
    }
  }

  openThumbnailPicker(): void {
    this.pickerCard = {};
    this.pickerVisible$.next(true);
  }

  onPickerClosed(): void {
    this.pickerVisible$.next(false);
    const picked = this.pickerCard.image;
    if (!picked?.url) {
      return;
    }
    this.state.commit(() => {
      this.block.props.thumbnailUrl = picked.url;
      this.block.props.customThumbnail = true;
    });
  }
}
