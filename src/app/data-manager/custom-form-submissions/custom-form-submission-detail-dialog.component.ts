import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { formatFieldValue } from '@impact-common/shared/models/domain/form-field.model';
import { FormSubmissionModel } from '@impact-common/shared/models/domain/form-submission.model';
import { extractSubmission } from '../../shared/form-submission-mapping.util';
import { CreateOrgContactDialogComponent, CreateOrgContactDialogResult } from '../../shared/create-org-contact-dialog/create-org-contact-dialog.component';

export interface CustomFormSubmissionDetailDialogData {
  item: FormSubmissionModel;
}

interface DetailRow {
  label: string;
  value: string;
}

// Renders fieldSnapshot zipped with values via formatFieldValue()
// (form-field.model.ts), so this dialog stays simple presentation with no
// per-type branching of its own. Reads the submission's own stored
// snapshot, never the live FormDefinitionModel - stays correct even if
// that form was since edited or deleted.
//
// One action beyond presentation (2026-08 restructure): "Create
// Organization + Contact" / "Create Contact" - offered when the shared
// extraction heuristics find an org-name field / person identity in the
// submission, admin-reviewed in CreateOrgContactDialogComponent. Content-
// driven, not form-id-driven, so future forms qualify automatically.
@Component({
    selector: 'app-custom-form-submission-detail-dialog',
    templateUrl: './custom-form-submission-detail-dialog.component.html',
    styleUrls: ['./custom-form-submission-detail-dialog.component.scss'],
    standalone: false
})
export class CustomFormSubmissionDetailDialogComponent {
  rows: DetailRow[];
  canCreateOrg: boolean;
  canCreateContact: boolean;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: CustomFormSubmissionDetailDialogData,
    private dialogRef: MatDialogRef<CustomFormSubmissionDetailDialogComponent>,
    private dialog: MatDialog
  ) {
    const item = data.item;
    this.rows = (item.fieldSnapshot ?? []).map((field) => ({
      label: field.label,
      value: formatFieldValue(field.type, item.values?.[field.id])
    }));

    const extracted = extractSubmission(item);
    this.canCreateOrg = !!extracted.orgName && !!extracted.hasIdentity;
    this.canCreateContact = extracted.hasIdentity;
  }

  alreadyCreated(): boolean {
    return !!this.data.item.createdRecords;
  }

  createRecords(mode: 'org' | 'contact'): void {
    const ref = this.dialog.open<CreateOrgContactDialogComponent, unknown, CreateOrgContactDialogResult>(CreateOrgContactDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: { submission: this.data.item, mode }
    });
    ref.afterClosed().subscribe((result) => {
      if (result) {
        // Reflect the stamp locally so the buttons flip to the created
        // state without a refetch.
        this.data.item.createdRecords = { ...result, at: new Date() };
      }
    });
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
