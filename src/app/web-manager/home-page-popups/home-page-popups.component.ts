import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { HomePagePopupModel } from 'src/app/common/models/domain/home-page-popup.model';
import { HomePagePopUpService } from 'src/app/common/services/data/home-page-popup.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../../shared/time-of-day.util';
import { HomePagePopupPreviewDialogComponent } from './home-page-popup-preview-dialog.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

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

  columns: DataGridColumn<HomePagePopupModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'fromDate', label: 'From Date', type: 'date', dateFormat: 'short' },
    { key: 'toDate', label: 'To Date', type: 'date', dateFormat: 'short' },
    { key: 'title', label: 'Title' },
    { key: 'width', label: 'Width', type: 'number' },
    { key: 'height', label: 'Height', type: 'number' },
    { key: 'bgColor', label: 'Background Color' }
  ];

  itemType = 'Home Page Popup';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<HomePagePopupModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit = false;
  richTextModules = RICH_TEXT_TOOLBAR;

  private editingItem: HomePagePopupModel | null = null;

  constructor(
    private service: HomePagePopUpService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.popups$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
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
