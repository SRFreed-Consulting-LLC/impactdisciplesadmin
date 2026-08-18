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
    { key: 'trigger', label: 'Trigger', value: (rule) => (rule.trigger === 'purchase' ? 'Purchased product' : 'Registered for event') },
    { key: 'target', label: 'Product / Event', value: (rule) => this.targetName(rule) },
    { key: 'tag', label: 'Tag' },
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

  targetName(rule: TagRuleModel): string {
    if (rule.trigger === 'purchase') {
      return this.products.find((p) => p.id === rule.productId)?.name ?? rule.productId ?? '—';
    }
    return this.events.find((e) => e.id === rule.eventId)?.name ?? rule.eventId ?? '—';
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
      productId: [rule?.productId ?? null],
      eventId: [rule?.eventId ?? null],
      // No '/' - the tag becomes part of a tag_applications doc id.
      tag: [rule?.tag ?? '', [Validators.required, Validators.pattern(/^[^/]+$/)]],
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
    const productId = trigger === 'purchase' ? (raw.productId ?? null) : null;
    const eventId = trigger === 'event-registration' ? (raw.eventId ?? null) : null;
    if ((trigger === 'purchase' && !productId) || (trigger === 'event-registration' && !eventId)) {
      this.snackbar.error(trigger === 'purchase' ? 'Pick a product for this rule' : 'Pick an event for this rule');
      return null;
    }
    // Explicit nulls, never undefined - the composer's own payload pattern.
    return {
      ...this.editingItem,
      name: (raw.name as string).trim(),
      trigger,
      productId,
      eventId,
      tag: (raw.tag as string).trim(),
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
    this.confirmService.confirm('<i>Delete this rule? Already-applied tags stay on customers.</i>', 'Confirm').then((confirmed) => {
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
    const confirmed = await this.confirmService.confirm(
      `Scan all ${scope} and tag every matching customer with "${this.editingItem.tag}"?`, 'Apply to Existing'
    );
    if (!confirmed) {
      return;
    }
    this.applying$.next(true);
    try {
      const result = await this.service.applyRetroactively(this.editingItem.id);
      this.snackbar.success(
        `Scanned ${result.scanned} records: ${result.matched} matched, ` +
        `${result.customersTagged} customer(s) tagged` +
        (result.skippedNoCustomer > 0 ? `, ${result.skippedNoCustomer} skipped (no customer record)` : '')
      );
    } catch (err) {
      this.snackbar.error('Apply failed: ' + ((err as Error)?.message ?? 'unknown error'));
    } finally {
      this.applying$.next(false);
    }
  }
}
