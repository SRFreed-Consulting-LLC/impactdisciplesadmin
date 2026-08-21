import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { SeriesModel } from '@impact-common/shared/models/utils/series.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class SeriesService extends BaseService<SeriesModel>{
  constructor(public override dao: FirebaseDAO<SeriesModel>) {
    super(dao)
    this.table="series"
  }
}
