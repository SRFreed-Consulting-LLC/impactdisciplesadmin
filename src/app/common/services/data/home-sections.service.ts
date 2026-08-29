import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BaseService } from './base.service';
import { HomeSectionModel } from '@impact-common/shared/models/domain/home-section.model';

@Injectable({
  providedIn: 'root'
})
export class HomeSectionService extends BaseService<HomeSectionModel> {
  constructor(public override dao: FirebaseDAO<HomeSectionModel>) {
    super(dao)
    this.table = "home_sections"
  }
}
