import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { EmailDesign, createDesignFromFullHtml, newDesignId } from 'src/app/common/models/admin/email-design.model';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';
import { STARTER_TEMPLATES } from 'src/app/common/utils/email/starter-templates';
import { MailTemplateKind, MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { EMailTemplatesService, kindOf } from 'src/app/common/services/data/email-templates.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';

// Which gallery this is (2026-08-21). 'system' is Tools Manager > System
// Templates' own picker; 'campaign' is the campaign email editor's. The
// two never show each other's saved templates - see MailTemplateModel's
// 'kind'. Absent data defaults to 'system', so the existing designer call
// site needed no change.
export interface TemplatePickerData {
  mode?: MailTemplateKind;
}

// What the shell does with the choice: start a new email from a COPY of
// the design, or jump to editing the template itself.
export type TemplatePickerResult =
  | { kind: 'use'; design: EmailDesign; subject: string | null }
  | { kind: 'edit'; id: string }
  | null;

interface TemplateCard {
  key: string;
  name: string;
  subject: string | null;
  description: string | null;
  // Compiled ONCE per card and trusted ONCE - a per-CD-cycle SafeHtml
  // rebuild makes the preview iframes reload in a loop (the same bug the
  // preview dialog had, live-diagnosed).
  srcdoc: SafeHtml;
  /** Set for saved templates (editable); null for built-in starters. */
  templateId: string | null;
  build: () => EmailDesign;
}

// A past sent email (a campaign_emails "touch" - Campaign Manager v2),
// paged straight off that collection newest-first; each page's rows carry
// their own html, so a page of 12 cards is ~300KB - loaded only when the
// section is opened (477 up-front would be ~12MB).
interface PastEmailCard {
  key: string;
  name: string;
  subject: string | null;
  sentLabel: string;
  /** How many sends collapsed into this card (1 = nothing collapsed). */
  editions: number;
  srcdoc: SafeHtml | null; // null while its html is still loading
  html: string | null;
}

// The template catalogue: card-style gallery of built-in starters plus
// every saved builder template, each card showing a LIVE scaled preview of
// its compiled email. "Use" starts a new email from a copy (fresh ids,
// never linked); "Edit" opens the template itself in the designer. A
// collapsed "Past Emails" section pages through the sent-email history
// (the same campaign_emails docs the Sent Emails log lists) - Use only,
// since history isn't editable; the copy it creates is. Since 2026-08-21
// this is the ONLY "start from something we already sent" path.
@Component({
    selector: 'app-template-picker-dialog',
    templateUrl: './template-picker-dialog.component.html',
    styleUrls: ['./template-picker-dialog.component.scss'],
    standalone: false
})
export class TemplatePickerDialogComponent {
  /** Which saved templates this gallery offers, and whether a card can be
   *  edited from here (only the System Templates picker can - the campaign
   *  editor has nowhere to send you). */
  readonly mode: MailTemplateKind;

  starterCards: TemplateCard[] = [];
  savedCards: TemplateCard[] = [];
  loadingSaved = true;

  // ---- Past Emails (collapsed until opened; paged) ----
  pastExpanded = false;
  pastCards: PastEmailCard[] = [];
  pastFilter = '';
  loadingPast = false;
  pastHasMore = true;
  private pastCursor: QueryDocumentSnapshot<DocumentData> | null = null;
  /** Normalised subject -> the card that survived, for the dedupe above. */
  private readonly pastBySubject = new Map<string, PastEmailCard>();
  private readonly pastPageSize = 12;

  constructor(
    private dialogRef: MatDialogRef<TemplatePickerDialogComponent, TemplatePickerResult>,
    private sanitizer: DomSanitizer,
    private campaignEmailService: CampaignEmailService,
    private templatesService: EMailTemplatesService,
    private permissionService: PermissionService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    @Inject(MAT_DIALOG_DATA) data: TemplatePickerData | null
  ) {
    this.mode = data?.mode === 'campaign' ? 'campaign' : 'system';
    this.starterCards = STARTER_TEMPLATES.map((starter) => {
      const design = starter.build();
      return {
        key: 'starter-' + starter.id,
        name: starter.name,
        subject: null,
        description: starter.description,
        srcdoc: this.trustPreview(design),
        templateId: null,
        build: starter.build
      };
    });

    this.templatesService.getAll().then((templates) => {
      // Only this gallery's own kind, and only builder templates - a
      // legacy Quill one has no design to preview or copy.
      this.savedCards = templates
        .filter((template) => !!template.design && kindOf(template) === this.mode)
        .map((template) => this.cardForTemplate(template));
      this.loadingSaved = false;
    });
  }

  useCard(card: TemplateCard): void {
    const design = card.templateId ? this.copyWithFreshIds(card.build()) : card.build();
    this.dialogRef.close({ kind: 'use', design, subject: card.subject });
  }

  editCard(card: TemplateCard): void {
    if (card.templateId && this.canEditCards) {
      this.dialogRef.close({ kind: 'edit', id: card.templateId });
    }
  }

  /** The campaign editor cannot host template editing - Edit navigates to
   *  the Tools Manager designer, which would abandon the email being
   *  written. Campaign templates are edited by using one and saving a new
   *  one. */
  get canEditCards(): boolean {
    return this.mode === 'system';
  }

  get savedLabel(): string {
    return this.mode === 'campaign' ? 'CAMPAIGN TEMPLATES' : 'SYSTEM TEMPLATES';
  }

  /** Deleting a saved template is gated by the DELETE grant on whichever
   *  screen owns that list - Tools Manager > System Templates for system
   *  ones, the campaigns screen for campaign ones. Starters and past
   *  emails are never deletable: starters are code, and a sent email is
   *  history. */
  get canDeleteCards(): boolean {
    return this.permissionService.canDelete(
      this.mode === 'campaign' ? 'campaigns-manager.campaigns' : 'tools-manager.email-designer'
    );
  }

  async deleteCard(card: TemplateCard, event: MouseEvent): Promise<void> {
    // The whole card is a hover target with its own Use button.
    event.stopPropagation();
    if (!card.templateId || !this.canDeleteCards) {
      return;
    }
    const confirmed = await this.confirmService.confirm(
      `Delete the template <b>${card.name}</b>? Emails already built from it are ` +
      'unaffected - their content was copied when they were created.',
      'Delete Template'
    );
    if (!confirmed) {
      return;
    }
    try {
      await this.templatesService.delete(card.templateId);
      this.savedCards = this.savedCards.filter((c) => c.key !== card.key);
      this.snackbar.success('Template deleted');
    } catch (err) {
      this.snackbar.error('Could not delete template: ' + ((err as Error)?.message ?? err));
    }
  }

  get savedEmptyText(): string {
    return this.mode === 'campaign'
      ? 'No campaign templates yet - use "Save as template" in the email editor to add one.'
      : 'No saved templates yet - any email design you save appears here.';
  }

  onCancel(): void {
    // null = caller keeps the blank default.
    this.dialogRef.close(null);
  }

  // ---- Past Emails ----

  togglePast(): void {
    this.pastExpanded = !this.pastExpanded;
    if (this.pastExpanded && this.pastCards.length === 0 && this.pastHasMore) {
      this.loadMorePast();
    }
  }

  // The filter only searches what's loaded so far (Firestore has no text
  // search) - the hint next to the input says so.
  get filteredPastCards(): PastEmailCard[] {
    const needle = this.pastFilter.trim().toLowerCase();
    if (!needle) {
      return this.pastCards;
    }
    return this.pastCards.filter((card) =>
      card.name.toLowerCase().includes(needle) || (card.subject ?? '').toLowerCase().includes(needle));
  }

  loadMorePast(): void {
    if (this.loadingPast || !this.pastHasMore) {
      return;
    }
    this.loadingPast = true;
    // orderBy sentAt excludes docs without it (future drafts) - exactly
    // right for a sent-history section.
    this.campaignEmailService.getPage(this.pastPageSize, this.pastCursor, 'sentAt', 'desc').then((page) => {
      this.pastCursor = page.cursor;
      this.pastHasMore = page.hasMore;
      // DEDUPE (2026-08-21). The raw collection is full of near-copies for
      // two different reasons, and the gallery showed every one of them:
      //   - true resends: the same subject AND the same body sent again a
      //     few days later to the people who did not open it (there is even
      //     a campaign literally named "Resend: ...");
      //   - recurring series: 44 sends all called "Disciple-Making Minute",
      //     each a different edition, which read as 44 identical cards.
      // Neither is useful as a STARTING POINT, where what you want is the
      // most recent version of each thing. Collapsing on the subject covers
      // both (477 sends -> 300 cards in prod) and, because the query is
      // newest-first, the survivor is always the latest edition. The count
      // is shown on the card so nothing looks silently dropped.
      let added = 0;
      for (const email of page.items) {
        const key = (email.subject || email.label || email.id!).trim().toLowerCase();
        const existing = this.pastBySubject.get(key);
        if (existing) {
          existing.editions++;
          continue;
        }
        const card: PastEmailCard = {
          key: email.id!,
          name: email.label || email.subject,
          subject: email.subject || null,
          sentLabel: (dateFromTimestamp(email.sentAt) as Date | null)?.toLocaleDateString() ?? '',
          editions: 1,
          srcdoc: this.sanitizer.bypassSecurityTrustHtml(email.html ?? ''),
          html: email.html ?? ''
        };
        this.pastBySubject.set(key, card);
        this.pastCards.push(card);
        added++;
      }
      this.loadingPast = false;
      // A page that was ALL duplicates would otherwise look like a dead
      // button, so keep pulling until something new shows up.
      if (added === 0 && this.pastHasMore) {
        this.loadMorePast();
      }
    });
  }

  usePastCard(card: PastEmailCard): void {
    if (!card.html) {
      return; // still loading - the button stays disabled until then
    }
    this.dialogRef.close({ kind: 'use', design: createDesignFromFullHtml(card.html), subject: card.subject });
  }

  private cardForTemplate(template: MailTemplateModel): TemplateCard {
    return {
      key: template.id!,
      name: template.name,
      subject: template.subject || null,
      description: null,
      // The stored compiled html IS the faithful preview - no recompile.
      srcdoc: this.sanitizer.bypassSecurityTrustHtml(template.html ?? ''),
      templateId: template.id!,
      build: () => JSON.parse(JSON.stringify(template.design)) as EmailDesign
    };
  }

  private trustPreview(design: EmailDesign): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(compileEmailDesign(design));
  }

  // A copied design gets brand-new ids throughout so drop-list ids, mobile
  // @media classes, and selections never collide across templates.
  private copyWithFreshIds(design: EmailDesign): EmailDesign {
    for (const section of design.sections) {
      section.id = newDesignId();
      for (const row of section.rows) {
        row.id = newDesignId();
        for (const column of row.columns) {
          column.id = newDesignId();
          for (const block of column.blocks) {
            block.id = newDesignId();
          }
        }
      }
    }
    return design;
  }
}
