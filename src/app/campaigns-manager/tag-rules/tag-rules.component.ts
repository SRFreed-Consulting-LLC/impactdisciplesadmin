import { Component, OnInit } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TagRuleModel, TagRuleTrigger } from 'src/app/common/models/domain/tag-rule.model';
import { TagRuleService } from 'src/app/common/services/data/tag-rule.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { Timestamp } from 'firebase/firestore';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

// Campaigns Manager > Tag Rules - "customer purchased X => tag 'Impact 1'",
// "customer registered for Y => tag 'DMC'". Rules run automatically on
// every new purchase/registration (customer-upsert triggers) and can be
// applied retroactively across history from here. Same in-page
// list/editor shape as products.component.ts.
@Component({
    selector: 'app-tag-rules',
    templateUrl: './tag-rules.component.html',
    styleUrls: ['./tag-rules.component.scss'],
    standalone: false
})
export class TagRulesComponent implements OnInit {
  mode: 'list' | 'edit' = 'list';

  rules: TagRuleModel[] = [];
  loading$ = new BehaviorSubject<boolean>(true);

  products: { id: string; name: string }[] = [];
  events: { id: string; name: string }[] = [];

  itemType = 'Tag Rule';
  private readonly screenKey = 'campaigns-manager.tag-rules';

  columns: DataGridColumn<TagRuleModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'trigger', label: 'Trigger', value: (rule) => this.triggerLabel(rule) },
    { key: 'target', label: 'Product / Event', value: (rule) => this.targetName(rule) },
    { key: 'tag', label: 'Tag', value: (rule) => this.tagLabel(rule) },
    { key: 'active', label: 'Active', value: (rule) => (rule.active ? 'Yes' : 'No') }
  ];

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<TagRuleModel>[] = [
    { icon: 'delete', tooltip: 'DELETE', onClick: (rule) => this.delete(rule), visible: () => this.permissionService.canDelete(this.screenKey) }
  ];

  // ---- Edit state ----
  form: FormGroup;
  editingItem: TagRuleModel | null = null;
  inProgress$ = new BehaviorSubject<boolean>(false);
  applying$ = new BehaviorSubject<boolean>(false);

  constructor(
    private service: TagRuleService,
    private productService: ProductService,
    private eventService: EventService,
    private permissionService: PermissionService,
    private fb: FormBuilder,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.loadRules();

    // One-time picker loads, same as campaign-composer's ngOnInit.
    this.productService.getAll().then((products) => {
      this.products = products.map((p) => ({ id: p.id!, name: p.title ?? p.id! }));
    });
    this.eventService.getAll().then((events) => {
      this.events = events.map((e) => ({ id: e.id!, name: e.eventName ?? e.id! }));
    });

    this.headerActions = this.permissionService.canAdd(this.screenKey)
      ? [{ label: 'New Rule', icon: 'add', onClick: () => this.showEditor(null) }]
      : [];
  }

  private loadRules(): void {
    this.service.getAll().then((rules) => {
      this.rules = rules;
      this.loading$.next(false);
    });
  }

  triggerLabel(rule: TagRuleModel): string {
    if (rule.trigger === 'purchase') {
      return 'Purchased product';
    }
    return rule.trigger === 'summit-registration' ? 'Registered for a Summit' : 'Registered for event';
  }

  tagLabel(rule: TagRuleModel): string {
    // Summit rules apply exactly one of two tags.
    return rule.trigger === 'summit-registration' ? `${rule.paidTag ?? '—'} / ${rule.tag}` : rule.tag;
  }

  // Effective target lists - the legacy single productId/eventId shapes
  // (rules saved before 2026-08-20) still display and edit correctly.
  private ruleProductIds(rule: TagRuleModel): string[] {
    return rule.productIds?.length ? rule.productIds : rule.productId ? [rule.productId] : [];
  }

  private ruleEventIds(rule: TagRuleModel): string[] {
    return rule.eventIds?.length ? rule.eventIds : rule.eventId ? [rule.eventId] : [];
  }

  targetName(rule: TagRuleModel): string {
    if (rule.trigger === 'summit-registration') {
      return 'Any Summit event';
    }
    if (rule.trigger === 'purchase') {
      const names = this.ruleProductIds(rule).map((id) => this.products.find((p) => p.id === id)?.name ?? id);
      return names.join(', ') || '—';
    }
    const names = this.ruleEventIds(rule).map((id) => this.events.find((e) => e.id === id)?.name ?? id);
    return names.join(', ') || '—';
  }

  // ---- Editor ----

  showEditor(rule: TagRuleModel | null): void {
    const canOpen = rule ? this.permissionService.canEdit(this.screenKey) : this.permissionService.canAdd(this.screenKey);
    if (!canOpen) {
      return;
    }
    this.editingItem = rule;
    this.form = this.fb.group({
      name: [rule?.name ?? '', Validators.required],
      trigger: [rule?.trigger ?? 'purchase', Validators.required],
      productIds: [rule ? this.ruleProductIds(rule) : []],
      eventIds: [rule ? this.ruleEventIds(rule) : []],
      // No '/' - the tag becomes part of a tag_applications doc id.
      tag: [rule?.tag ?? '', [Validators.required, Validators.pattern(/^[^/]+$/)]],
      paidTag: [rule?.paidTag ?? '', Validators.pattern(/^[^/]+$/)],
      active: [rule?.active ?? true]
    });
    this.mode = 'edit';
  }

  onCancel(): void {
    this.mode = 'list';
    this.editingItem = null;
  }

  private buildPayload(): TagRuleModel | null {
    const raw = this.form.value;
    const trigger = raw.trigger as TagRuleTrigger;
    const productIds = trigger === 'purchase' ? ((raw.productIds as string[]) ?? []) : [];
    const eventIds = trigger === 'event-registration' ? ((raw.eventIds as string[]) ?? []) : [];
    if (trigger === 'purchase' && productIds.length === 0) {
      this.snackbar.error('Pick at least one product for this rule');
      return null;
    }
    if (trigger === 'event-registration' && eventIds.length === 0) {
      this.snackbar.error('Pick at least one event for this rule');
      return null;
    }
    const paidTag = trigger === 'summit-registration' ? ((raw.paidTag as string) ?? '').trim() : '';
    if (trigger === 'summit-registration' && !paidTag) {
      this.snackbar.error('Summit rules need a paid-registration tag too');
      return null;
    }
    // Explicit nulls, never undefined - the composer's own payload pattern.
    // Legacy single-target fields are nulled out on save so the multi
    // shapes are the single source of truth from here on.
    return {
      ...this.editingItem,
      name: (raw.name as string).trim(),
      trigger,
      productId: null,
      eventId: null,
      productIds: productIds.length ? productIds : null,
      eventIds: eventIds.length ? eventIds : null,
      tag: (raw.tag as string).trim(),
      paidTag: paidTag || null,
      active: !!raw.active,
      createdDate: this.editingItem?.createdDate ?? Timestamp.now()
    };
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.buildPayload();
    if (!value) {
      return;
    }
    this.inProgress$.next(true);
    const request = this.editingItem?.id ? this.service.update(this.editingItem.id, value) : this.service.add(value);
    request.then((result) => {
      this.inProgress$.next(false);
      if (!result) {
        this.snackbar.error('Some Error Occured');
        return;
      }
      this.snackbar.success(this.itemType + (this.editingItem?.id ? ' Updated' : ' Added'));
      this.mode = 'list';
      this.editingItem = null;
      this.loadRules();
    });
  }

  delete(rule: TagRuleModel): void {
    this.confirmService.confirm('<i>Delete this rule? Already-applied tags stay on contacts.</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(rule.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
          this.loadRules();
        });
      }
    });
  }

  // ---- Retroactive sweep ----

  canApplyRetroactively(): boolean {
    return !!this.editingItem?.id && this.permissionService.canEdit(this.screenKey);
  }

  async applyRetroactively(): Promise<void> {
    if (!this.editingItem?.id || this.applying$.value) {
      return;
    }
    const scope = this.editingItem.trigger === 'purchase' ? 'past purchases' : 'past event registrations';
    const tagText = this.editingItem.trigger === 'summit-registration'
      ? `"${this.editingItem.paidTag}" (paid) or "${this.editingItem.tag}" (free)`
      : `"${this.editingItem.tag}"`;
    const confirmed = await this.confirmService.confirm(
      `Scan all ${scope} and tag every matching contact with ${tagText}?`, 'Apply to Existing'
    );
    if (!confirmed) {
      return;
    }
    this.applying$.next(true);
    try {
      const result = await this.service.applyRetroactively(this.editingItem.id);
      this.snackbar.success(
        `Scanned ${result.scanned} records: ${result.matched} matched, ` +
        `${result.customersTagged} contact(s) tagged` +
        (result.skippedNoCustomer > 0 ? `, ${result.skippedNoCustomer} skipped (no contact record)` : '')
      );
    } catch (err) {
      this.snackbar.error('Apply failed: ' + ((err as Error)?.message ?? 'unknown error'));
    } finally {
      this.applying$.next(false);
    }
  }
}
