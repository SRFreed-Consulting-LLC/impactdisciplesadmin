import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MailTemplateModel } from 'impactdisciplescommon/src/models/admin/mail.model';
import { EMailTemplatesService } from 'impactdisciplescommon/src/services/data/email-templates.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { EmailTemplateDialogComponent } from './email-template-dialog.component';

@Component({
    selector: 'app-email-templates',
    templateUrl: './email-templates.component.html',
    styleUrls: ['./email-templates.component.css'],
    standalone: false
})
export class EmailTemplatesComponent implements OnInit {
  templates$: Observable<MailTemplateModel[]>;
  displayedColumns = ['name', 'subject', 'actions'];
  filterColumns = ['name-filter', 'subject-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Email Template';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: EMailTemplatesService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.templates$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) => Object.keys(filters).every((field) => matchesColumnFilter(item[field as keyof MailTemplateModel], filters[field], 'text')))
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      )
    );
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
