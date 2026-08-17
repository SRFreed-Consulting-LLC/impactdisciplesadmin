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

  // Both variants are built ONCE - a getter that re-wrapped the html in a
  // fresh SafeHtml per change-detection cycle makes Angular rebind [srcdoc]
  // every cycle, which reloads the iframe in a loop (live-diagnosed as a
  // flaky, often-blank preview).
  private readonly rawSrcdoc: SafeHtml;
  private readonly sampleSrcdoc: SafeHtml;

  constructor(
    private dialogRef: MatDialogRef<PreviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PreviewDialogData,
    sanitizer: DomSanitizer
  ) {
    // srcdoc of a sandboxed iframe (no scripts allowed by the sandbox
    // attr); the content is our own compiler's output.
    const compiled = compileEmailDesign(data.design, { title: data.title });
    this.rawSrcdoc = sanitizer.bypassSecurityTrustHtml(compiled);
    this.sampleSrcdoc = sanitizer.bypassSecurityTrustHtml(renderMergeTags(compiled, sampleMergeContext()));
  }

  get frameWidth(): number {
    return this.device === 'mobile' ? 375 : 680;
  }

  get srcdoc(): SafeHtml {
    return this.withSampleData ? this.sampleSrcdoc : this.rawSrcdoc;
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
