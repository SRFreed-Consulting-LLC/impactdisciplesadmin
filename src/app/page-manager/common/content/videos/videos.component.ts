import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { Video } from '../../models/ui/video.model';
import { QueryParam, WhereFilterOperandKeys } from 'impactdisciplescommon/src/dao/firebase.dao';
import { VideoService } from '../../services/video.service';

@Component({
    selector: 'app-videos',
    templateUrl: './videos.component.html',
    standalone: false
})
export class VideosComponent implements OnInit, OnDestroy {
  @Input('video_type') videoType: string;

  allVideos: Video[] = [];
  currentVideo: Video = {... new Video()};

  private ngUnsubscribe = new Subject<void>();

  constructor(private videoService: VideoService) {}

  ngOnInit(): void {
    let qp: QueryParam[] = [];
    qp.push(new QueryParam('video_year', WhereFilterOperandKeys.equal, new Date().getFullYear()));
    qp.push(new QueryParam('video_type', WhereFilterOperandKeys.equal, this.videoType));

    this.videoService.queryAllStreamByMultiValue(qp).pipe(takeUntil(this.ngUnsubscribe)).subscribe(videos => {
      this.allVideos = videos;

      this.currentVideo = this.allVideos[this.allVideos.length-1];
    })
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  changeCurrentRecord(e){
    if(e.value){
      this.videoService.getById(e.value).then(video => {
        this.currentVideo = video;
      })
    }
  }

  getHeight(video: Video){
    return window.innerHeight/window.innerWidth * video.video_height;
  }

  getWidth(video: Video){
    return window.innerHeight/window.innerWidth * video.video_width;
  }
}
