import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { Observable, tap } from 'rxjs';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { FAQModel } from '@impact-common/shared/models/utils/faq.model';
import { FAQService } from 'src/app/common/services/data/faq.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { BaseListComponent } from '../../../../shared/base-list.component';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../../shared/snackbar.service';
import { DataGridColumn } from '../../../../shared/data-grid/data-grid.model';
import { FaqDialogComponent } from './faq-dialog.component';

// Two concerns in one screen, matching the original: (a) a global FAQ
// library (its own Firestore collection, plain add/edit/delete) and (b)
// per-event membership (event.faqList) via checkbox selection on the same
// table - mirrors SubscriptionsComponent's SelectionModel pattern exactly
// (src/app/contacts-manager/subscriptions).
@Component({
    selector: 'app-faq',
    templateUrl: './faq.component.html',
    styleUrls: ['./faq.component.scss'],
    standalone: false
})
export class FAQComponent extends BaseListComponent<FAQModel> implements OnChanges {
  @Input() event: EventModel;

  readonly columns: DataGridColumn<FAQModel>[] = [
    { key: 'sortOrder', label: 'Sort Order', type: 'number' },
    { key: 'question', label: 'Question' },
    { key: 'answer', label: 'Answer', filterable: false, cellClass: 'answer-cell', exportValue: (item) => this.stripHtml(item.answer ?? '') }
  ];

  readonly itemType = 'FAQ';
  // UNGATED: this table lives inside the event editor, which is what gates
  // it; the FAQ library has no NAV_CONFIG entry of its own.
  protected readonly screenKey = null;
  protected readonly dialogComponent = FaqDialogComponent;
  protected override readonly dialogConfig: MatDialogConfig = { width: '700px' };

  selection = new SelectionModel<FAQModel>(true, []);

  private selectionInitialized = false;

  constructor(
    service: FAQService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }

  protected override loadItems(): Observable<FAQModel[]> {
    return this.service.streamAll().pipe(
      tap((items) => {
        // Only pre-select once, the first time the library loads - after
        // that, selection changes are user-driven and shouldn't be
        // clobbered by every subsequent stream emission.
        if (!this.selectionInitialized) {
          this.selectionInitialized = true;
          if (!this.event.faqList) {
            this.event.faqList = [];
          }
          const memberIds = new Set(this.event.faqList.map((f) => f.id));
          items.filter((item) => memberIds.has(item.id)).forEach((item) => this.selection.select(item));
        }
        this.loading$.next(false);
      })
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['event'] && !changes['event'].firstChange) {
      this.selectionInitialized = false;
    }
  }

  private stripHtml(html: string): string {
    return html ? html.replace(/<[^>]*>/g, '') : '';
  }

  onSelectionChange(): void {
    this.event.faqList = this.selection.selected;
  }

  // A deleted FAQ leaves the event's own list too, not just the library.
  protected override onDeleted(item: FAQModel): void {
    this.selection.deselect(item);
    this.onSelectionChange();
  }
}
