import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { RESIZE_PRESETS, ResizePreset, isResizable } from './image-resize.util';

/** What the picker hands in: the files about to go up. */
export interface UploadSizeData {
  files: File[];
}

/**
 * HOW BIG SHOULD THIS PICTURE BE, asked once per upload.
 *
 * ASKED RATHER THAN DECIDED because the right answer depends on where the
 * picture is going, and only the person uploading it knows that - a hero
 * band and a book cover want very different files and both arrive through
 * this one control. A fixed cap would be wrong half the time in one
 * direction or the other.
 *
 * DEFAULTS TO MEDIUM, not Original. The problem being solved is that
 * everything currently arrives at whatever size it happened to be, so a
 * default of "leave it alone" would change nothing for anyone who does not
 * read the dialog - which is most people, most of the time. Medium is the
 * size most pictures on this site actually want, and Original is one click
 * away for the cases that need it.
 *
 * Files that CANNOT be resized - an SVG, an animated GIF, a PDF dropped in
 * by mistake - are listed separately and pass through untouched, so nobody
 * picks "Small" and wonders why the logo is unchanged.
 */
@Component({
  selector: 'app-upload-size-dialog',
  templateUrl: './upload-size-dialog.component.html',
  styleUrls: ['./upload-size-dialog.component.scss'],
  standalone: false
})
export class UploadSizeDialogComponent {
  readonly presets = RESIZE_PRESETS;

  /** Medium - see the class comment on why this is not 'original'. */
  chosen = 'medium';

  readonly resizable: File[];
  readonly passthrough: File[];

  constructor(
    private dialogRef: MatDialogRef<UploadSizeDialogComponent, ResizePreset | false>,
    @Inject(MAT_DIALOG_DATA) public data: UploadSizeData
  ) {
    this.resizable = data.files.filter((f) => isResizable(f));
    this.passthrough = data.files.filter((f) => !isResizable(f));
  }

  /** Rounded to whole KB or MB - a size is a sense of scale here, not a
   *  measurement, and "1.4 MB" reads faster than "1,432 KB". */
  sizeOf(file: File): string {
    const kb = file.size / 1024;
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onUpload(): void {
    this.dialogRef.close(this.presets.find((p) => p.key === this.chosen) ?? this.presets[0]);
  }
}
