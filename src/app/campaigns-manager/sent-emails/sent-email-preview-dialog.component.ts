import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export interface SentEmailPreviewData {
  title: string;
  subject: string;
  // The email AS SENT (full document from campaign_emails) - shown verbatim,
  // no compiling/merge-tag pass; this is history, not a draft.
  html: string;
}

// Read-only preview of a past sent email in a sandboxed iframe - same
// memoized-srcdoc + sandbox="allow-same-origin" treatment as the designer's
// PreviewDialogComponent (see its comments for why both matter), minus the
// sample-data toggle (nothing to substitute in an already-sent email).
@Component({
    selector: 'app-sent-email-preview-dialog',
    templateUrl: './sent-email-preview-dialog.component.html',
    styleUrls: ['./sent-email-preview-dialog.component.scss'],
    standalone: false
})
export class SentEmailPreviewDialogComponent {
  device: 'desktop' | 'mobile' = 'desktop';

  readonly srcdoc: SafeHtml;

  constructor(
    private dialogRef: MatDialogRef<SentEmailPreviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SentEmailPreviewData,
    sanitizer: DomSanitizer
  ) {
    this.srcdoc = sanitizer.bypassSecurityTrustHtml(data.html);
  }

  get frameWidth(): number {
    return this.device === 'mobile' ? 375 : 680;
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
