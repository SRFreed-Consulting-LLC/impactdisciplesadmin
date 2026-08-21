import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { EmailDesign, createDesignFromFullHtml, newDesignId } from 'src/app/common/models/admin/email-design.model';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';
import { STARTER_TEMPLATES } from 'src/app/common/utils/email/starter-templates';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';

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
  private readonly pastPageSize = 12;

  constructor(
    private dialogRef: MatDialogRef<TemplatePickerDialogComponent, TemplatePickerResult>,
    private sanitizer: DomSanitizer,
    private campaignEmailService: CampaignEmailService,
    templatesService: EMailTemplatesService
  ) {
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

    templatesService.getAll().then((templates) => {
      this.savedCards = templates
        .filter((template) => !!template.design)
        .map((template) => this.cardForTemplate(template));
      this.loadingSaved = false;
    });
  }

  useCard(card: TemplateCard): void {
    const design = card.templateId ? this.copyWithFreshIds(card.build()) : card.build();
    this.dialogRef.close({ kind: 'use', design, subject: card.subject });
  }

  editCard(card: TemplateCard): void {
    if (card.templateId) {
      this.dialogRef.close({ kind: 'edit', id: card.templateId });
    }
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
      for (const email of page.items) {
        this.pastCards.push({
          key: email.id!,
          name: email.label || email.subject,
          subject: email.subject || null,
          sentLabel: (dateFromTimestamp(email.sentAt) as Date | null)?.toLocaleDateString() ?? '',
          srcdoc: this.sanitizer.bypassSecurityTrustHtml(email.html ?? ''),
          html: email.html ?? ''
        });
      }
      this.loadingPast = false;
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
