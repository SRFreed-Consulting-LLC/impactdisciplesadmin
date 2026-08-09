import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { FAQModel } from 'src/app/common/models/utils/faq.model';
import { FAQService } from 'src/app/common/services/data/faq.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../../shared/snackbar.service';
import { ListHeaderAction } from '../../../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../../../shared/table-export.util';
import { FaqDialogComponent } from './faq-dialog.component';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

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
  columns: ColumnDef[] = [
    { key: 'sortOrder', label: 'Sort Order', visible: true },
    { key: 'question', label: 'Question', visible: true },
    { key: 'answer', label: 'Answer', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'FAQ';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  selection = new SelectionModel<FAQModel>(true, []);

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});
  private currentRows: FAQModel[] = [];
  private selectionInitialized = false;

  constructor(
    private service: FAQService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.faqs$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) => Object.keys(filters).every((field) => matchesColumnFilter((item as any)[field], filters[field], field === 'sortOrder' ? 'number' : 'text')))
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      ),
      tap((items) => {
        this.currentRows = items;
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

  get displayedColumns(): string[] {
    return ['select', ...this.columns.filter((c) => c.visible).map((c) => c.key), 'actions'];
  }

  get filterColumns(): string[] {
    return ['select-filter', ...this.columns.filter((c) => c.visible).map((c) => `${c.key}-filter`), 'actions-filter'];
  }

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<FAQModel>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => (c.key === 'answer' ? this.stripHtml((item as any).answer) : (item as any)[c.key]) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'faqs.xlsx');
  }

  private stripHtml(html: string): string {
    return html ? html.replace(/<[^>]*>/g, '') : '';
  }

  isAllSelected(): boolean {
    return this.currentRows.length > 0 && this.currentRows.every((row) => this.selection.isSelected(row));
  }

  masterToggle(): void {
    this.isAllSelected() ? this.selection.clear() : this.currentRows.forEach((row) => this.selection.select(row));
    this.onSelectionChange();
  }

  toggleRow(item: FAQModel): void {
    this.selection.toggle(item);
    this.onSelectionChange();
  }

  private onSelectionChange(): void {
    this.event.faqList = this.selection.selected;
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
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
