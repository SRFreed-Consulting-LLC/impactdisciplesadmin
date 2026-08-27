import { Component, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, filter, take } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { MailTemplateModel, MailTemplateKind, TEMPLATE_HOME_KINDS } from 'src/app/common/models/admin/mail.model';
import { createDefaultDesign, createDesignFromFullHtml, createDesignFromLegacyHtml } from 'src/app/common/models/admin/email-design.model';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';
import { stripUndefinedDeep } from 'src/app/common/utils/strip-undefined';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { DesignerStateService } from './designer-state.service';
import { PreviewDialogComponent } from './preview/preview-dialog.component';
import { SendTestDialogComponent } from './preview/send-test-dialog.component';
import { TemplatePickerDialogComponent, TemplatePickerResult } from './template-picker/template-picker-dialog.component';

// Full-screen Mailchimp-style email builder. Reached from Tools Manager >
// System Templates ("New Email Design" / editing a builder template) at
// /tools-manager/email-designer/new | /:id. No NavLeaf of its own - it
// rides the tools-manager.system-templates grants (see nav-config.ts).
//
// This instance only ever authors SYSTEM templates - the campaign email
// editor has its own gallery and its own "Save as template" (2026-08-21).
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
  private currentUserEmail = '';

  /** Firestore's per-document ceiling is 1 MiB; this leaves room for the
   *  name/subject/attachments and Firestore's own field-name overhead, so a
   *  save that passes this check is not then rejected by the server. */
  private static readonly MAX_TEMPLATE_BYTES = 900 * 1024;

  constructor(
    public state: DesignerStateService,
    private route: ActivatedRoute,
    private router: Router,
    private service: EMailTemplatesService,
    private campaignEmailService: CampaignEmailService,
    private permissionService: PermissionService,
    private authService: AdminAuthService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    // paramMap SUBSCRIPTION, not a one-shot snapshot: the template gallery's
    // Edit action navigates /new -> /:id while this component instance stays
    // mounted (Angular reuses it for same-route param changes), so the load
    // must re-run on every id change.
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      const templateId = id && id !== 'new' ? id : null;
      if (templateId === this.templateId && this.currentUserEmail) {
        return;
      }
      this.templateId = templateId;
      this.loading$.next(true);

      // On a cold page load (direct URL / refresh) PermissionService's
      // cached user hasn't arrived yet when this runs, and a synchronous
      // canAdd/canEdit would read as "no permission" and bounce a
      // legitimate admin. authGuard already vouches for authentication on
      // this route, so wait for the first real user emission before judging
      // grants (the same live-source pattern the tab shells use).
      this.authService.dao.loggedInUser$
        .pipe(
          filter((user) => !!user),
          take(1)
        )
        .subscribe((user) => {
          this.currentUserEmail = user?.email ?? '';
          this.checkAccessAndLoad();
        });
    });
  }

  private checkAccessAndLoad(): void {
    const allowed = this.templateId
      ? this.permissionService.canEdit('tools-manager.system-templates')
      : this.permissionService.canAdd('tools-manager.system-templates');
    if (!allowed) {
      this.backToList();
      return;
    }

    if (!this.templateId) {
      // ?fromEmail=<id>: seed a NEW design from a past sent email's body
      // (the picker's "Past Emails" cards; the campaign_emails doc is never
      // touched). Skips the picker - the user already chose. Sent Emails'
      // own "open in designer" row action fed this too until 2026-08-21,
      // when that screen became a read-only history; the picker is the one
      // way in now.
      const fromEmailId = this.route.snapshot.queryParamMap.get('fromEmail');
      if (fromEmailId) {
        this.campaignEmailService.getById(fromEmailId).then((email) => {
          if (!email?.html) {
            this.snackbar.error('No stored email body for that record.');
            this.backToList();
            return;
          }
          this.state.load(createDesignFromFullHtml(email.html));
          this.templateSubject = email.subject ?? '';
          this.loading$.next(false);
        });
        return;
      }

      this.state.load(createDefaultDesign());
      this.loading$.next(false);
      // The template catalogue: card previews of starters + saved
      // templates. "Use" starts from a copy, "Edit" jumps to the template
      // itself, Cancel keeps the blank default.
      this.dialog
        .open<TemplatePickerDialogComponent, void, TemplatePickerResult>(
          TemplatePickerDialogComponent, { width: '980px', maxWidth: '95vw' }
        )
        .afterClosed()
        .subscribe((result) => {
          if (result?.kind === 'use') {
            this.state.load(result.design);
            if (result.subject && !this.templateSubject) {
              this.templateSubject = result.subject;
            }
          } else if (result?.kind === 'edit') {
            // Same component instance - the paramMap subscription in
            // ngOnInit picks this up and loads the template.
            this.router.navigate(['/tools-manager/email-designer', result.id]);
          }
        });
      return;
    }

    this.service.getById(this.templateId).then((template) => {
      if (!template) {
        this.snackbar.error('Template not found');
        this.backToList();
        return;
      }
      this.existing = template;
      this.templateName = template.name;
      this.templateSubject = template.subject ?? '';
      // Builder templates load their design; legacy (Quill/html-only)
      // templates are imported as one full-width text block - content
      // preserved verbatim, converted to a builder template on first save.
      this.state.load(template.design ?? createDesignFromLegacyHtml(template.html ?? ''));
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

  /** Where each `from` key sends Back, mirroring TemplateEditorReturn in
   *  EmailTemplateEditorService. Keys rather than URLs, for the same reason
   *  that service uses them: a return-URL parameter would let any link that
   *  reaches this screen redirect it anywhere. `idParam` is set only where
   *  the target screen actually reads a deep link - handing over one it
   *  ignores would promise a return to the record and deliver the list. */
  private static readonly RETURN_TARGETS: Record<
    string,
    { route: string; tab: string; label: string; idParam?: string }
  > = {
    fulfillment: { route: '/contacts-manager', tab: 'fulfillment', label: 'Fulfillment' },
    // The Sales Receipt is edited from Store Manager > Products' "Order
    // Receipt" action, not from a purchase - it is store-wide config, and by
    // the time an order exists its receipt has already gone out.
    store: { route: '/store-manager', tab: 'products', label: 'Products' },
    product: { route: '/store-manager', tab: 'products', label: 'Products' },
    event: { route: '/events-manager', tab: 'events', label: 'Events', idParam: 'eventId' },
    summit: { route: '/events-manager', tab: 'summit', label: 'Summit', idParam: 'eventId' },
    campaign: { route: '/campaigns-manager', tab: 'campaigns', label: 'the campaign', idParam: 'campaignId' }
  };

  /** Names where Back actually goes, so the button does not promise
   *  "System Templates" while returning to a campaign or a process screen. */
  get backTooltip(): string {
    const params = this.route.snapshot.queryParamMap;
    if (params.get('fromCampaign')) {
      return 'Back to the campaign';
    }
    const target = EmailDesignerComponent.RETURN_TARGETS[params.get('from') ?? ''];
    return target ? `Back to ${target.label}` : 'Back to System Templates';
  }

  onBack(): void {
    // Router navigation runs the CanDeactivate guard, which handles the
    // dirty prompt - no separate confirm here.
    this.backToList();
  }

  onPreview(): void {
    this.dialog.open(PreviewDialogComponent, {
      width: '900px',
      height: '90vh',
      maxWidth: '95vw',
      data: { design: this.state.design, subject: this.templateSubject, title: this.templateName }
    });
  }

  onSendTest(): void {
    this.dialog.open(SendTestDialogComponent, {
      width: '440px',
      data: {
        design: this.state.design,
        subject: this.templateSubject,
        title: this.templateName,
        defaultTo: this.currentUserEmail
      }
    });
  }

  /**
   * The kind a newly-saved template takes, from ?kind= on the URL.
   *
   * Allow-listed against TEMPLATE_HOME_KINDS rather than trusted: an
   * unrecognised value would produce a template that reads back as 'system'
   * (see kindOf) while the screen that created it filters on the kind it
   * asked for - so the admin would save an email and watch it vanish. Falling
   * back to 'system' puts it somewhere visible instead.
   */
  private newTemplateKind(): MailTemplateKind {
    const requested = this.route.snapshot.queryParamMap.get('kind');
    return TEMPLATE_HOME_KINDS.includes(requested as never)
      ? (requested as MailTemplateKind)
      : 'system';
  }

  onSave(): void {
    const name = this.templateName.trim();
    if (!name) {
      this.snackbar.error('Give the email design a name before saving');
      return;
    }

    const design = stripUndefinedDeep(this.state.design);
    const compiled = compileEmailDesign(design, { title: name });

    // A builder template stores the design tree AND the html it compiles to,
    // on one document, against Firestore's 1 MiB per-document limit. A legacy
    // template that is already large converts to something roughly twice its
    // size - "Elevate Workshops Registration Success" is 953 KB of mostly one
    // base64-inlined image, and would not fit.
    //
    // This matters more since the editor stopped branching on `design`: every
    // template now OPENS here, including ones too big to save. Without this
    // the write is rejected by Firestore and surfaces as "Some Error
    // Occured", which says nothing about what is wrong or what would fix it.
    const size = new Blob([JSON.stringify(design), compiled]).size;
    if (size > EmailDesignerComponent.MAX_TEMPLATE_BYTES) {
      this.snackbar.error(
        `This email is ${Math.round(size / 1024)} KB, over the ` +
        `${Math.round(EmailDesignerComponent.MAX_TEMPLATE_BYTES / 1024)} KB a single ` +
        'template can hold. It is almost always an image pasted into the body - ' +
        'upload it as an image block instead, which stores a link rather than the ' +
        'whole file.'
      );
      return;
    }

    this.saving$.next(true);
    const value: MailTemplateModel = {
      ...(this.existing ?? { attachments: [] as unknown[] }),
      name,
      subject: this.templateSubject.trim(),
      // Edits keep the doc's existing kind. A NEW template takes the kind the
      // launching screen asked for (?kind=product from a product's follow-up
      // list) and falls back to 'system' - so the designer reached from
      // System Templates still makes system templates, and one reached from
      // a screen that owns its own list makes something that lands in it.
      kind: this.existing?.kind ?? this.newTemplateKind(),
      design,
      html: compiled
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

  /**
   * Back goes to whatever LAUNCHED the designer, not to where the designer
   * happens to live.
   *
   * The designer is System Templates' editing surface and has no nav entry of
   * its own, so Back used to be hard-coded to that screen. But a campaign's
   * email opens the same designer (campaign-detail's openInDesigner), and
   * landing on System Templates after editing a campaign email is simply the
   * wrong place - a different manager, with no way back to the campaign but
   * the browser's own history.
   *
   * `fromCampaign` is read as an id and fed to the campaigns list's existing
   * ?campaignId= deep link, rather than the caller handing over a URL to
   * navigate to - a return-URL parameter would let any link that reaches
   * this screen redirect it anywhere.
   */
  private backToList(): void {
    const params = this.route.snapshot.queryParamMap;
    const fromCampaign = params.get('fromCampaign');
    if (fromCampaign) {
      this.router.navigate(['/campaigns-manager'], {
        queryParams: { tab: 'campaigns', campaignId: fromCampaign }
      });
      return;
    }

    // ?from=<screen>[&fromId=<record>], set by EmailTemplateEditorService
    // when a transactional template is opened from the process that sends
    // it. Written when that service landed but never reachable until the
    // first transactional template became a builder template (Amazon
    // Shipping Confirmation, 2026-08-27) - before that every one of them
    // opened as a dialog over the calling screen and never navigated at all.
    // Without this, Back drops the admin on System Templates: the screen
    // these templates are LEAVING, where the one they just edited no longer
    // appears.
    const target = EmailDesignerComponent.RETURN_TARGETS[params.get('from') ?? ''];
    if (target) {
      const id = params.get('fromId');
      this.router.navigate([target.route], {
        queryParams: { tab: target.tab, ...(id && target.idParam ? { [target.idParam]: id } : {}) }
      });
      return;
    }

    this.router.navigate(['/tools-manager'], { queryParams: { tab: 'system-templates' } });
  }
}
