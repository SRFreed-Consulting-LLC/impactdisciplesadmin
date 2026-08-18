import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { EmailDesign, newDesignId } from 'src/app/common/models/admin/email-design.model';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';
import { STARTER_TEMPLATES } from 'src/app/common/utils/email/starter-templates';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';

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

// The template catalogue: card-style gallery of built-in starters plus
// every saved builder template, each card showing a LIVE scaled preview of
// its compiled email. "Use" starts a new email from a copy (fresh ids,
// never linked); "Edit" opens the template itself in the designer.
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

  constructor(
    private dialogRef: MatDialogRef<TemplatePickerDialogComponent, TemplatePickerResult>,
    private sanitizer: DomSanitizer,
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
