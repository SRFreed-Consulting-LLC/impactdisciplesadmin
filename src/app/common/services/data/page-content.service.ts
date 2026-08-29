import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BaseService } from './base.service';
import { PageContentModel } from '@impact-common/shared/models/domain/page-content.model';

/**
 * The editable content of the public pages - one document per page, id = the
 * page's route slug. See PageContentModel.
 */
@Injectable({
  providedIn: 'root'
})
export class PageContentService extends BaseService<PageContentModel> {
  constructor(public override dao: FirebaseDAO<PageContentModel>) {
    super(dao)
    this.table = "page_content"
  }
}
