import { Injectable, signal } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { PodCastModel } from '@impact-common/shared/models/domain/pod-cast.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';
import { environment } from 'src/environments/environment';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';

// Shape of a single item from the YouTube Data API v3 playlistItems
// endpoint (https://developers.google.com/youtube/v3/docs/playlistItems) -
// only the fields this service/pod-casts.component.ts actually reads.
export interface YoutubePlaylistItem {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    thumbnails: {
      high: { url: string };
      maxres?: { url: string };
    };
  };
  contentDetails: {
    videoId: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class PodCastService extends BaseService<PodCastModel>{
  constructor(public override dao: FirebaseDAO<PodCastModel>, private authService: AdminAuthService) {
    super(dao)
    this.table="pod_casts"
    this.fromFirestore = PodCastService.fromFirestore
  }

  static readonly fromFirestore = (data): PodCastModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };

  videos = signal<YoutubePlaylistItem[]>([]);

  async getVideoInfo(){
    this.videos = signal<YoutubePlaylistItem[]>([]);

    // get_youtube_videos requires a real staff Firebase Auth session and
    // makes the YouTube Data API call server-side, returning only the video
    // list - the API key never reaches the browser (see
    // functions/src/youtube.functions.ts). Attach the caller's own ID token,
    // same pattern as shipping-labels.component.ts's getShippingLabel().
    const idToken = await this.authService.dao.auth.currentUser?.getIdToken();

    const response = await fetch(environment.youtubeVideosUrl, {
      headers: { Authorization: 'Bearer ' + idToken }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch podcast videos');
    }

    const result = await response.json();

    this.videos.set((result.videos ?? []) as YoutubePlaylistItem[]);

    return this.videos();
  }
}


