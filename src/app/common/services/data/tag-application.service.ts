import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BaseModel } from 'src/app/common/models/base.model';
import { BaseService } from './base.service';

// One doc per (customer email, tag) - when/why a tag landed on a customer,
// and the anchorDate the auto-campaign scheduler's "N days after" clock
// counts from. Normally written server-side (tag rules); this service
// covers the one legitimate client path: manual tag add/remove on
// Customer Details. Doc id is `${email}__${tag}` (matches
// functions/src/tag-rules.functions.ts's tagApplicationId()).
export class TagApplicationModel extends BaseModel {
  email = '';
  tag = '';
  appliedAt: Timestamp;
  anchorDate: Timestamp;
  source: 'purchase' | 'event-registration' | 'manual' = 'manual';
  sourceId: string | null = null;
  ruleId: string | null = null;
}

export function tagApplicationId(email: string, tag: string): string {
  return `${email}__${tag}`;
}

@Injectable({
  providedIn: 'root'
})
export class TagApplicationService extends BaseService<TagApplicationModel> {
  constructor(public override dao: FirebaseDAO<TagApplicationModel>) {
    super(dao);
    this.table = 'tag_applications';
  }

  /** Records a manual tag application (anchor = now). update() setDocs at
   *  the deterministic id - creating it when absent, which is the only
   *  case this is called for (the chips UI can't add an already-present
   *  tag; rules deny true updates). */
  recordManualApplication(email: string, tag: string): Promise<TagApplicationModel> {
    const now = Timestamp.now();
    const doc: TagApplicationModel = {
      email,
      tag,
      appliedAt: now,
      anchorDate: now,
      source: 'manual',
      sourceId: null,
      ruleId: null
    };
    return this.update(tagApplicationId(email, tag), doc);
  }

  removeApplication(email: string, tag: string): Promise<void> {
    return this.delete(tagApplicationId(email, tag)) as unknown as Promise<void>;
  }
}
