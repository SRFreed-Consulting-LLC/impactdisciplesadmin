import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { TagRuleModel } from 'src/app/common/models/domain/tag-rule.model';
import { BaseService } from './base.service';

// The applyTagRuleRetroactively callable's result counts
// (functions/src/tag-rules.functions.ts).
export interface RetroactiveTagResult {
  scanned: number;
  matched: number;
  customersTagged: number;
  applicationsCreated: number;
  skippedNoCustomer: number;
}

@Injectable({
  providedIn: 'root'
})
export class TagRuleService extends BaseService<TagRuleModel> {
  // Same field-inject pattern PurchasesService uses for its callable.
  private functions = inject(Functions);

  constructor(public override dao: FirebaseDAO<TagRuleModel>) {
    super(dao);
    this.table = 'tag_rules';
  }

  /** Admin-triggered sweep of historic purchases/event-registrations for
   *  one rule - server-side paging, returns the result counts. */
  async applyRetroactively(ruleId: string): Promise<RetroactiveTagResult> {
    const fn = httpsCallable<{ ruleId: string }, RetroactiveTagResult>(
      this.functions, 'applyTagRuleRetroactively'
    );
    const result = await fn({ ruleId });
    return result.data;
  }
}
