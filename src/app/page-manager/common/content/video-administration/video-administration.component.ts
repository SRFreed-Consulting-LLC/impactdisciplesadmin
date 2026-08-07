import { Component, OnInit } from '@angular/core';
import CustomStore from 'devextreme/data/custom_store';
import { QueryParam, WhereFilterOperandKeys } from 'impactdisciplescommon/src/dao/firebase.dao';
import { Video } from '../../models/ui/video.model';
import { VideoService } from '../../services/video.service';

@Component({
    selector: 'app-video-administration',
    templateUrl: './video-administration.component.html',
    styleUrls: ['./video-administration.component.scss'],
    standalone: false
})
export class VideoAdministrationComponent implements OnInit {
  breadCrumbItems: Array<{}>;

  videoDataSource: any = {};

  years: number[] = []

  months: any[] = [];

  constructor(public videoService: VideoService) {
    this.videoDataSource = new CustomStore({
      key: "dbId",
      loadMode: "raw",
      load: function (loadOptions: any) {
          let qp: QueryParam[] = [];
          qp.push(new QueryParam('video_year', WhereFilterOperandKeys.equal, new Date().getFullYear()));
          return videoService.getAll();
      },
      insert: function(value: Video) {
        return videoService.add(value);
      },
      update: function(key: any, value: Video) {
        return videoService.update(key, value);
      },
      remove: function (id: any) {
        return videoService.delete(id);
      },
    });
  }

  ngOnInit() {
    this.breadCrumbItems = [{ label: 'Admin' }, { label: 'Take 5 Video Administration', active: true }];
    this.getMonths();
    this.getYears();
  }

  onRowUpdating(options) {
    options.newData = Object.assign(options.oldData, options.newData);
  }

  getScreenHeight(): number{
    return window.innerHeight*.4;
  }

  rmdNames(rmds, e){
    let retval: string[]  = [];

    if(e.value && e.value.length > 0){
      e.value.forEach(id => {
        retval.push(rmds.find(rmd => rmd.p_agent_id == id).p_agent_name);
      });
    }
    return retval.toString();
  }

  getYears(){
    let years: number[] = [];
    let year: number = new Date().getUTCFullYear();

    for (let index = year; index > year - 2; index--) {
      years.push(index);
    }

    this.years = years;
  }

  getMonths(){
    this.months.push({name: 'January', value: 1});
    this.months.push({name: 'February', value: 2});
    this.months.push({name: 'March', value: 3});
    this.months.push({name: 'April', value: 4});
    this.months.push({name: 'May', value: 5});
    this.months.push({name: 'June', value: 6});
    this.months.push({name: 'July', value: 7});
    this.months.push({name: 'August', value: 8});
    this.months.push({name: 'September', value: 9});
    this.months.push({name: 'October', value: 10});
    this.months.push({name: 'November', value: 11});
    this.months.push({name: 'December', value: 12});
  }
}
