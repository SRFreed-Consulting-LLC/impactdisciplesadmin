import { Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { TagRuleModel } from 'src/app/common/models/domain/tag-rule.model';
import { BaseService } from './base.service';
import { CALLABLE_FUNCTIONS } from '@impact-common/shared/contract/functions-contract';
import {
  ApplyTagRuleRetroactivelyRequest,
  ApplyTagRuleRetroactivelyResult,
} from '@impact-common/shared/contract/admin-callables.types';

// The applyTagRuleRetroactively callable's result counts
// (functions/src/tag-rules.functions.ts).
/** Alias of the shared contract's ApplyTagRuleRetroactivelyResult (Stage 2e-ii). */
export type RetroactiveTagResult = ApplyTagRuleRetroactivelyResult;

@Injectable({
  providedIn: 'root'
})
export class TagRuleService extends BaseService<TagRuleModel> {
  // Same field-inject pattern PurchasesService uses for its callable.
  constructor(
    public override dao: FirebaseDAO<TagRuleModel>,
    private functions: Functions
  ) {
    super(dao);
    this.table = 'tag_rules';
  }

  /** Admin-triggered sweep of historic purchases/event-registrations for
   *  one rule - server-side paging, returns the result counts. */
  async applyRetroactively(ruleId: string): Promise<RetroactiveTagResult> {
    const fn = httpsCallable<ApplyTagRuleRetroactivelyRequest, ApplyTagRuleRetroactivelyResult>(
      this.functions, CALLABLE_FUNCTIONS.applyTagRuleRetroactively
    );
    const result = await fn({ ruleId });
    return result.data;
  }
}
