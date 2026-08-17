import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { EmailTemplateDialogComponent } from './email-template-dialog.component';

@Component({
    selector: 'app-email-templates',
    templateUrl: './email-templates.component.html',
    styleUrls: ['./email-templates.component.css'],
    standalone: false
})
export class EmailTemplatesComponent implements OnInit {
  templates$: Observable<MailTemplateModel[]>;

  columns: DataGridColumn<MailTemplateModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'subject', label: 'Subject' },
    // Which editor authored the template - presence of `design` marks a
    // builder template (edits in the full-screen designer), absence a
    // legacy rich-text one (edits in the Quill dialog).
    { key: 'editorType', label: 'Editor', value: (row) => (row.design ? 'Email Builder' : 'Rich Text') }
  ];

  itemType = 'Email Template';

  private readonly screenKey = 'tools-manager.email-templates';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<MailTemplateModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private service: EMailTemplatesService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.templates$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));

    // Two creation paths: the full-screen Mailchimp-style builder (new
    // default) and the legacy Quill dialog for lighter rich-text templates.
    this.headerActions = this.permissionService.canAdd(this.screenKey)
      ? [
          { label: 'New Email Design', icon: 'add', onClick: () => this.newEmailDesign() },
          { label: 'New Rich Text Template', icon: 'notes', onClick: () => this.showAddModal() }
        ]
      : [];
  }

  newEmailDesign(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.router.navigate(['/tools-manager/email-designer/new']);
  }

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.dialog.open(EmailTemplateDialogComponent, {
      width: '800px',
      data: { item: null }
    });
  }

  showEditModal(item: MailTemplateModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    // Builder templates edit in the full-screen designer; legacy templates
    // keep the Quill dialog.
    if (item.design) {
      this.router.navigate(['/tools-manager/email-designer', item.id]);
      return;
    }
    this.dialog.open(EmailTemplateDialogComponent, {
      width: '800px',
      data: { item }
    });
  }

  delete(item: MailTemplateModel): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
