import { Component, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, filter, take } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { createDefaultDesign } from 'src/app/common/models/admin/email-design.model';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';
import { stripUndefinedDeep } from 'src/app/common/utils/strip-undefined';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { DesignerStateService } from './designer-state.service';

// Full-screen Mailchimp-style email builder. Reached from Tools Manager >
// Email Templates ("New Email Design" / editing a builder template) at
// /tools-manager/email-designer/new | /:id. No NavLeaf of its own - it
// rides the tools-manager.email-templates grants (see nav-config.ts).
@Component({
    selector: 'app-email-designer',
    templateUrl: './email-designer.component.html',
    styleUrls: ['./email-designer.component.scss'],
    standalone: false,
    providers: [DesignerStateService]
})
export class EmailDesignerComponent implements OnInit {
  templateName = 'Untitled email';
  templateSubject = '';
  loading$ = new BehaviorSubject<boolean>(true);
  saving$ = new BehaviorSubject<boolean>(false);

  private templateId: string | null = null;
  private existing: MailTemplateModel | null = null;

  constructor(
    public state: DesignerStateService,
    private route: ActivatedRoute,
    private router: Router,
    private service: EMailTemplatesService,
    private permissionService: PermissionService,
    private authService: AdminAuthService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.templateId = id && id !== 'new' ? id : null;

    // On a cold page load (direct URL / refresh) PermissionService's cached
    // user hasn't arrived yet when ngOnInit runs, and a synchronous
    // canAdd/canEdit would read as "no permission" and bounce a legitimate
    // admin. authGuard already vouches for authentication on this route, so
    // wait for the first real user emission before judging grants (the same
    // live-source pattern the tab shells use).
    this.authService.dao.loggedInUser$
      .pipe(
        filter((user) => !!user),
        take(1)
      )
      .subscribe(() => this.checkAccessAndLoad());
  }

  private checkAccessAndLoad(): void {
    const allowed = this.templateId
      ? this.permissionService.canEdit('tools-manager.email-templates')
      : this.permissionService.canAdd('tools-manager.email-templates');
    if (!allowed) {
      this.backToList();
      return;
    }

    if (!this.templateId) {
      this.state.load(createDefaultDesign());
      this.loading$.next(false);
      return;
    }

    this.service.getById(this.templateId).then((template) => {
      if (!template?.design) {
        // Not a builder template (legacy Quill templates edit in the old
        // dialog) or gone - nothing for this editor to do.
        this.snackbar.error('Template not found or not an Email Builder template');
        this.backToList();
        return;
      }
      this.existing = template;
      this.templateName = template.name;
      this.templateSubject = template.subject ?? '';
      this.state.load(template.design);
      this.loading$.next(false);
    });
  }

  // Consulted by emailDesignerCanDeactivateGuard.
  canLeave(): Promise<boolean> {
    if (!this.state.dirty) {
      return Promise.resolve(true);
    }
    return this.confirmService.confirm('Discard unsaved changes to this email design?', 'Unsaved Changes');
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.state.inlineEditing || !(event.ctrlKey || event.metaKey)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.state.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      this.state.redo();
    }
  }

  onCanvasBackgroundClick(): void {
    this.state.deselect();
  }

  setViewMode(mode: 'desktop' | 'mobile'): void {
    this.state.viewMode = mode;
  }

  onBack(): void {
    // Router navigation runs the CanDeactivate guard, which handles the
    // dirty prompt - no separate confirm here.
    this.backToList();
  }

  onSave(): void {
    const name = this.templateName.trim();
    if (!name) {
      this.snackbar.error('Give the email design a name before saving');
      return;
    }

    this.saving$.next(true);
    const design = stripUndefinedDeep(this.state.design);
    const value: MailTemplateModel = {
      ...(this.existing ?? { attachments: [] as unknown[] }),
      name,
      subject: this.templateSubject.trim(),
      design,
      html: compileEmailDesign(design, { title: name })
    } as MailTemplateModel;

    const request = this.templateId ? this.service.update(this.templateId, value) : this.service.add(value);

    request.then((result) => {
      this.saving$.next(false);
      if (!result) {
        this.snackbar.error('Some Error Occured');
        return;
      }
      this.state.dirty = false;
      this.snackbar.success(this.templateId ? 'Email Design Updated' : 'Email Design Saved');
      if (!this.templateId && (result as MailTemplateModel)?.id) {
        // Stay in the editor, but re-anchor the URL to the new id so
        // refresh/re-edit works.
        this.templateId = (result as MailTemplateModel).id!;
        this.existing = value;
        this.router.navigate(['/tools-manager/email-designer', this.templateId], { replaceUrl: true });
      } else {
        this.existing = value;
      }
    });
  }

  private backToList(): void {
    this.router.navigate(['/tools-manager'], { queryParams: { tab: 'email-templates' } });
  }
}
