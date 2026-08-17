import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { EmailDesign } from 'src/app/common/models/admin/email-design.model';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';
import { renderMergeTags, sampleMergeContext } from 'src/app/common/utils/email/merge-tags';

export interface PreviewDialogData {
  design: EmailDesign;
  subject: string;
  title: string;
}

// Full preview of the COMPILED email HTML (the exact string that sends) in
// a sandboxed iframe - not the canvas's approximation. Desktop/mobile width
// toggle and a sample-data toggle that runs the merge-tag engine with the
// registry's sample values.
@Component({
    selector: 'app-preview-dialog',
    templateUrl: './preview-dialog.component.html',
    styleUrls: ['./preview-dialog.component.scss'],
    standalone: false
})
export class PreviewDialogComponent {
  device: 'desktop' | 'mobile' = 'desktop';
  withSampleData = false;

  private readonly compiledHtml: string;

  constructor(
    private dialogRef: MatDialogRef<PreviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PreviewDialogData,
    private sanitizer: DomSanitizer
  ) {
    this.compiledHtml = compileEmailDesign(data.design, { title: data.title });
  }

  get frameWidth(): number {
    return this.device === 'mobile' ? 375 : 680;
  }

  // srcdoc of a sandboxed iframe (no scripts allowed by the sandbox attr);
  // the content is our own compiler's output.
  get srcdoc(): SafeHtml {
    const html = this.withSampleData
      ? renderMergeTags(this.compiledHtml, sampleMergeContext())
      : this.compiledHtml;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
