import { Injectable, signal } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { PodCastModel } from 'src/app/common/models/domain/pod-cast.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class PodCastService extends BaseService<PodCastModel>{
  API_KEY
  PLAY_LIST_ID;

  constructor(public override dao: FirebaseDAO<PodCastModel> ) {
    super(dao)
    this.table="pod_casts"
    this.fromFirestore = PodCastService.fromFirestore
  }

  static readonly fromFirestore = (data): PodCastModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };

  videos = signal<any[]>([]);

  async getVideoInfo(){
    this.videos = signal<any[]>([]);

    const keysResponse = await fetch(environment.youtubeKeyUrl);

    if (!keysResponse.ok) {
      throw new Error('Failed to fetch client secret');
    }

    const keysResult = await keysResponse.json();

    this.API_KEY = keysResult.api_key;
    this.PLAY_LIST_ID = keysResult.playlist_key

    let pageToken: string =  await this.callYoutube(this.PLAY_LIST_ID);

    while (pageToken){
      pageToken = await this.callYoutube(this.PLAY_LIST_ID, pageToken);
    }

    return this.videos();
  }

  private async callYoutube(playlistId: string, pageToken?: string){
    const videos: any[] = [];

    let playListItemsUrl = `https://www.googleapis.com/youtube/v3/playlistItems?key=${this.API_KEY}&part=snippet,contentDetails&maxResults=50&&playlistId=${playlistId}`;

    if(pageToken){
      playListItemsUrl += "&pageToken=" + pageToken
    }

    const response = await fetch(playListItemsUrl);

    if (!response.ok) {
      throw new Error('Failed to fetch client secret');
    }

    const result = await response.json();

    videos.push(...result.items);

    if(result.nextPageToken){
      pageToken = result.nextPageToken;

    } else {
      pageToken = null;
    }

    this.videos.update(vids => vids = [...vids, ...videos])

    return result.nextPageToken
  }
}


