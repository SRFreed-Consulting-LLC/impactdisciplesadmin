import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { EMailTemplatesService, kindOf } from 'src/app/common/services/data/email-templates.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { EmailTemplateDialogComponent } from './email-template-dialog.component';

// Tools Manager > System Templates - the templates the APP sends from:
// sales receipts, event registration confirmations, product follow-ups,
// each resolved by name or id inside a Cloud Function. Renamed from
// 'Email Templates' 2026-08-21 when marketing templates were split into
// the campaign email editor's own gallery; both still live in
// mail_templates, told apart by 'kind'.
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
    // Which editor OWNS the template - presence of `design` marks a builder
    // template, absence a rich-text one. Since 2026-08-21 this drives which
    // editor Edit actually opens (see showEditModal), so it is a live fact
    // about the row rather than a note about its history.
    { key: 'editorType', label: 'Editor', value: (row) => (row.design ? 'Email Builder' : 'Rich Text') }
  ];

  itemType = 'System Template';

  private readonly screenKey = 'tools-manager.system-templates';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<MailTemplateModel>[] = [
    {
      icon: 'brush',
      tooltip: 'OPEN IN EMAIL BUILDER',
      onClick: (item) => this.openInBuilder(item),
      // Only rich-text templates have anywhere to be converted TO.
      visible: (item) => !item.design && this.permissionService.canEdit(this.screenKey)
    },
    { icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }
  ];

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
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
    // SYSTEM templates only (2026-08-21). Campaign templates share this
    // collection but belong to the campaign email editor's own gallery;
    // kindOf() treats a doc with no 'kind' as system, which is what every
    // pre-split template is.
    this.templates$ = this.service.streamAll().pipe(
      map((templates) => templates.filter((t) => kindOf(t) === 'system')),
      tap(() => this.loading$.next(false))
    );

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

  // Opens the editor that MATCHES the template (2026-08-21). Between
  // 2026-08-17 and this change every template opened in the full-screen
  // designer, including legacy Quill ones - which imported them as a single
  // text block and silently converted them to builder templates on the
  // first save. That is a one-way door, and on a SYSTEM template it is a
  // real hazard: these are placeholder documents a Cloud Function
  // substitutes into ({{firstName}}, {{product_list}} - see
  // renderPlaceholders), so fixing a typo in a sales receipt should not
  // quietly restructure its markup into builder scaffolding. The Editor
  // column now describes something stable, and converting is a deliberate
  // act - see openInBuilder().
  showEditModal(item: MailTemplateModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    if (item.design) {
      this.router.navigate(['/tools-manager/email-designer', item.id]);
      return;
    }
    this.dialog.open(EmailTemplateDialogComponent, {
      width: '800px',
      data: { item }
    });
  }

  /** Deliberately upgrade a legacy rich-text template to the builder. Kept
   *  as its own action rather than folded into Edit so the conversion is a
   *  choice; it is one-way, and the confirm says so. */
  async openInBuilder(item: MailTemplateModel): Promise<void> {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    const confirmed = await this.confirmService.confirm(
      `Open <b>${item.name}</b> in the Email Builder? Its current content comes across as ` +
      'a single text block, and saving there converts it to a builder template for good. ' +
      'Any {{placeholders}} keep working.',
      'Convert to Email Builder'
    );
    if (confirmed) {
      this.router.navigate(['/tools-manager/email-designer', item.id]);
    }
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
