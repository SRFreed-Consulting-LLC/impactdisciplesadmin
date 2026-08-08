import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { HomePagePopupModel } from 'impactdisciplescommon/src/models/domain/home-page-popup.model';

export interface HomePagePopupPreviewDialogData {
  item: HomePagePopupModel;
}

// Live preview of the popup exactly as it will appear on the public site:
// no title bar/chrome (see panelClass: 'preview-dialog-panel' at the
// dialog.open() call site, which strips the default MatDialog padding -
// the Material equivalent of the original's imperative
// `.option('elementAttr', { class: 'no-padding-popup' })` on its nested
// dx-popup), sized to the record's own configured width/height, background
// color, and raw HTML content.
@Component({
    selector: 'app-home-page-popup-preview-dialog',
    templateUrl: './home-page-popup-preview-dialog.component.html',
    styleUrls: ['./home-page-popup-preview-dialog.component.scss'],
    standalone: false
})
export class HomePagePopupPreviewDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<HomePagePopupPreviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: HomePagePopupPreviewDialogData
  ) {}

  onClose(): void {
    this.dialogRef.close();
  }
}
