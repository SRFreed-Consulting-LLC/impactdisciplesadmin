import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { HomePagePopupModel } from 'src/app/common/models/domain/home-page-popup.model';
import { HomePagePopUpService } from 'src/app/common/services/data/home-page-popup.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../../shared/time-of-day.util';
import { HomePagePopupPreviewDialogComponent } from './home-page-popup-preview-dialog.component';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-home-page-popups',
    templateUrl: './home-page-popups.component.html',
    styleUrls: ['./home-page-popups.component.css'],
    standalone: false
})
export class HomePagePopupsComponent implements OnInit {
  // No route/URL involved on purpose - see the edit view's own comment
  // below. 'list' shows the grid, 'edit' swaps the same content area over
  // to a full edit form (no popup), with a "Preview" button opening a real
  // MatDialog of just the rendered popup itself.
  mode: 'list' | 'edit' = 'list';

  popups$: Observable<HomePagePopupModel[]>;
  currentRows: HomePagePopupModel[] = [];
  columns: ColumnDef[] = [
    { key: 'isActive', label: 'Live', visible: true },
    { key: 'fromDate', label: 'From Date', visible: true },
    { key: 'toDate', label: 'To Date', visible: true },
    { key: 'title', label: 'Title', visible: true },
    { key: 'width', label: 'Width', visible: true },
    { key: 'height', label: 'Height', visible: true },
    { key: 'bgColor', label: 'Background Color', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;
  numberOperators = NUMBER_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Home Page Popup';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit = false;
  richTextModules = RICH_TEXT_TOOLBAR;

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});
  private editingItem: HomePagePopupModel | null = null;

  constructor(
    private service: HomePagePopUpService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.popups$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        const filtered = items.filter((item) =>
          Object.keys(filters).every((field) => {
            const type = field === 'fromDate' || field === 'toDate' ? 'date' : field === 'width' || field === 'height' ? 'number' : 'text';
            return matchesColumnFilter(item[field as keyof HomePagePopupModel], filters[field], type);
          })
        );
        this.currentRows = filtered;
        return filtered;
      }),
      tap(() => this.loading$.next(false))
    );
  }

  get displayedColumns(): string[] {
    return [...this.columns.filter((c) => c.visible).map((c) => c.key), 'actions'];
  }

  get filterColumns(): string[] {
    return [...this.columns.filter((c) => c.visible).map((c) => `${c.key}-filter`), 'actions-filter'];
  }

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  private fieldValue(item: HomePagePopupModel, field: string): any {
    switch (field) {
      case 'isActive': return item.isActive ? 'LIVE' : 'INACTIVE';
      default: return (item as any)[field];
    }
  }

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<HomePagePopupModel>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => this.fieldValue(item, c.key) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'home_page_popups.xlsx');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.editingItem = null;
    this.isEdit = false;
    this.buildForm(null);
    this.mode = 'edit';
  }

  showEditModal(item: HomePagePopupModel): void {
    this.editingItem = item;
    this.isEdit = true;
    this.buildForm(item);
    this.mode = 'edit';
  }

  private buildForm(item: HomePagePopupModel | null): void {
    this.form = this.fb.group({
      isActive: [item?.isActive ?? false],
      fromDate: [toDateTimeLocalValue(item?.fromDate), Validators.required],
      toDate: [toDateTimeLocalValue(item?.toDate), Validators.required],
      title: [item?.title ?? '', Validators.required],
      width: [item?.width ?? null, Validators.required],
      height: [item?.height ?? null, Validators.required],
      bgColor: [item?.bgColor ?? '#000000', Validators.required],
      // The original always seeded a brand new popup's body with this exact
      // empty shell (a full-bleed, zero-margin div) rather than leaving it
      // blank - matches showAddModal().
      text: [item?.text ?? '<div style="margin: 0px; padding: 0px; height: 100%; width:100%;"></div>']
    });
  }

  onCancel(): void {
    this.inProgress$.next(false);
    this.mode = 'list';
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const raw = this.form.value;
    const value: HomePagePopupModel = {
      ...this.editingItem,
      ...raw,
      fromDate: fromDateTimeLocalValue(raw.fromDate),
      toDate: fromDateTimeLocalValue(raw.toDate)
    };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.mode = 'list';
        this.inProgress$.next(false);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }

  showPreview(): void {
    const raw = this.form.value;
    this.dialog.open(HomePagePopupPreviewDialogComponent, {
      width: `${raw.width || 400}px`,
      height: `${raw.height || 300}px`,
      panelClass: 'preview-dialog-panel',
      data: { item: { ...this.editingItem, ...raw } as HomePagePopupModel }
    });
  }

  delete(item: HomePagePopupModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
