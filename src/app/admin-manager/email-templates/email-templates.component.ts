import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { EmailTemplateDialogComponent } from './email-template-dialog.component';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-email-templates',
    templateUrl: './email-templates.component.html',
    styleUrls: ['./email-templates.component.css'],
    standalone: false
})
export class EmailTemplatesComponent implements OnInit {
  templates$: Observable<MailTemplateModel[]>;
  currentRows: MailTemplateModel[] = [];
  columns: ColumnDef[] = [
    { key: 'name', label: 'Name', visible: true },
    { key: 'subject', label: 'Subject', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Email Template';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: EMailTemplatesService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.templates$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        const filtered = items
          .filter((item) => Object.keys(filters).every((field) => matchesColumnFilter(item[field as keyof MailTemplateModel], filters[field], 'text')))
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
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

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<MailTemplateModel>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => (item as any)[c.key] ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'email_templates.xlsx');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(EmailTemplateDialogComponent, {
      width: '800px',
      data: { item: null }
    });
  }

  showEditModal(item: MailTemplateModel): void {
    this.dialog.open(EmailTemplateDialogComponent, {
      width: '800px',
      data: { item }
    });
  }

  delete(item: MailTemplateModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
