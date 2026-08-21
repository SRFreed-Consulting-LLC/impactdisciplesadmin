import { Component, Inject } from '@angular/core';
import Quill from 'quill';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { insertQuillVariable } from '../../shared/rich-text-editor/variable-inserter.component';

export interface EmailTemplateDialogData {
  item: MailTemplateModel | null;
}

@Component({
    selector: 'app-email-template-dialog',
    templateUrl: './email-template-dialog.component.html',
    styleUrls: ['./email-template-dialog.component.scss'],
    standalone: false
})
export class EmailTemplateDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  richTextModules = RICH_TEXT_TOOLBAR;

  // Mirrors the original dxo-variables datasource on the email templates'
  // dx-html-editor - these become {{Recipient First Name}}-style
  // placeholders swapped in when the template is actually sent.
  emailVals: string[] = ['Recipient First Name', 'Recipient Last Name', 'Sender First Name', 'Sender Last Name'];

  private itemType = 'System Template';
  private quill: Quill | undefined;

  constructor(
    private dialogRef: MatDialogRef<EmailTemplateDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: EmailTemplateDialogData,
    private fb: FormBuilder,
    private service: EMailTemplatesService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      name: [data.item?.name ?? '', Validators.required],
      subject: [data.item?.subject ?? '', Validators.required],
      html: [data.item?.html ?? '']
    });
  }

  onEditorCreated(quill: Quill): void {
    this.quill = quill;
  }

  insertVariable(variableName: string): void {
    insertQuillVariable(this.quill, variableName);
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    // Reached only from the System Templates screen, so a new template
    // authored here is a system one. An edit keeps whatever kind the doc
    // already had rather than restamping it.
    const value: MailTemplateModel = {
      ...this.data.item,
      ...this.form.value,
      kind: this.data.item?.kind ?? 'system'
    };

    const request = this.isEdit
      ? this.service.update(value.id!, value)
      : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
