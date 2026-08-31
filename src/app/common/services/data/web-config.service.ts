import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { WebConfigModel } from '@impact-common/shared/models/utils/web-config.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class WebConfigService extends BaseService<WebConfigModel>{
  // getAll() is called independently from 15+ components across the app for
  // what is effectively static, rarely-changing site config -- cache the
  // in-flight/completed fetch so repeated calls share one Firestore read
  // instead of each component re-fetching the whole collection. This
  // service is a singleton (providedIn: 'root' via BaseService), so the
  // cache lives for the app's session.
  private cachedConfig: Promise<WebConfigModel[]> | null = null;

  constructor(public override dao: FirebaseDAO<WebConfigModel>) {
    super(dao)
    this.table="config"
    this.fromFirestore = WebConfigService.fromFirestore
  }

  // fromFirestore normalised `taxImportDate` here until 2026-08-31. That
  // field is gone - nothing had read it since tax rates stopped being
  // imported - so there is nothing left to reshape on the way in, and a
  // hook that only re-wrote a dead field is worse than no hook.
  static readonly fromFirestore = (data): WebConfigModel => data;

  override getAll(): Promise<WebConfigModel[]> {
    if (!this.cachedConfig) {
      this.cachedConfig = super.getAll();
    }

    return this.cachedConfig;
  }
}
