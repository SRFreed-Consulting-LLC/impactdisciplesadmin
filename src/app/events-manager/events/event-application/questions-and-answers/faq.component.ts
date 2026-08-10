import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { FAQModel } from 'src/app/common/models/utils/faq.model';
import { FAQService } from 'src/app/common/services/data/faq.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../../shared/snackbar.service';
import { ListHeaderAction } from '../../../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../../../shared/data-grid/data-grid.model';
import { FaqDialogComponent } from './faq-dialog.component';

// Two concerns in one screen, matching the original: (a) a global FAQ
// library (its own Firestore collection, plain add/edit/delete) and (b)
// per-event membership (event.faqList) via checkbox selection on the same
// table - mirrors NewsletterSubscriptionComponent's SelectionModel pattern
// exactly (src/app/subscriptions-manager/newsletter-subscription).
@Component({
    selector: 'app-faq',
    templateUrl: './faq.component.html',
    styleUrls: ['./faq.component.scss'],
    standalone: false
})
export class FAQComponent implements OnInit, OnChanges {
  @Input() event: EventModel;

  faqs$: Observable<FAQModel[]>;

  columns: DataGridColumn<FAQModel>[] = [
    { key: 'sortOrder', label: 'Sort Order', type: 'number' },
    { key: 'question', label: 'Question' },
    { key: 'answer', label: 'Answer', filterable: false, cellClass: 'answer-cell', exportValue: (item) => this.stripHtml(item.answer ?? '') }
  ];

  itemType = 'FAQ';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<FAQModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  selection = new SelectionModel<FAQModel>(true, []);

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private allFaqs: FAQModel[] = [];
  private selectionInitialized = false;

  constructor(
    private service: FAQService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.faqs$ = this.service.streamAll().pipe(
      tap((items) => {
        this.allFaqs = items;
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

  showAddModal(): void {
    this.dialog.open(FaqDialogComponent, { width: '700px', data: { item: null } });
  }

  showEditModal(item: FAQModel): void {
    this.dialog.open(FaqDialogComponent, { width: '700px', data: { item } });
  }

  delete(item: FAQModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.selection.deselect(item);
          this.onSelectionChange();
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
