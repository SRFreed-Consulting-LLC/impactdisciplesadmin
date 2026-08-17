import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { EmailDesign, newDesignId } from 'src/app/common/models/admin/email-design.model';
import { STARTER_TEMPLATES, StarterTemplate } from 'src/app/common/utils/email/starter-templates';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';

// "Start from" gallery shown when creating a new email design: built-in
// starters plus the user's existing builder templates (copied - fresh ids,
// never linked, so editing the new email can't touch the original).
@Component({
    selector: 'app-template-picker-dialog',
    templateUrl: './template-picker-dialog.component.html',
    styleUrls: ['./template-picker-dialog.component.scss'],
    standalone: false
})
export class TemplatePickerDialogComponent {
  starters: StarterTemplate[] = STARTER_TEMPLATES;
  savedTemplates: MailTemplateModel[] = [];

  constructor(
    private dialogRef: MatDialogRef<TemplatePickerDialogComponent, EmailDesign | null>,
    templatesService: EMailTemplatesService
  ) {
    templatesService.getAll().then((templates) => {
      this.savedTemplates = templates.filter((template) => !!template.design);
    });
  }

  pickStarter(starter: StarterTemplate): void {
    this.dialogRef.close(starter.build());
  }

  pickSaved(template: MailTemplateModel): void {
    const copy = JSON.parse(JSON.stringify(template.design)) as EmailDesign;
    this.reassignIds(copy);
    this.dialogRef.close(copy);
  }

  onCancel(): void {
    // null = caller keeps the blank default.
    this.dialogRef.close(null);
  }

  // A copied design gets brand-new ids throughout so drop-list ids, mobile
  // @media classes, and selections never collide across templates.
  private reassignIds(design: EmailDesign): void {
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
  }
}
