import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

/**
 * The slider's slides, in a dialog.
 *
 * A HOST, not an editor: it frames the existing Home Page Images grid, which
 * already owns adding, editing, deleting, the drag-reordering and the
 * order-clash warning. Nothing about a slide is edited here.
 *
 * Why a dialog at all - the slides used to sit open on the Home screen,
 * under the slider's row. That made one section behave unlike the other
 * five and gave the stack a 400px hole in the middle of it, so the running
 * order of the page was hard to read at a glance, which is the one thing
 * that screen is for. Every section is now opened the same way.
 *
 * Editing a slide opens the slide dialog ON TOP of this one. Material stacks
 * them, and closing the inner one returns here rather than to the stack.
 */
@Component({
    selector: 'app-home-slides-dialog',
    templateUrl: './home-slides-dialog.component.html',
    styleUrls: ['./home-slides-dialog.component.css'],
    standalone: false
})
export class HomeSlidesDialogComponent {
  constructor(private readonly dialogRef: MatDialogRef<HomeSlidesDialogComponent, boolean>) {}

  /**
   * Always closes TRUE. Slides are saved as they are edited - by the slide
   * dialog, and by the drag handler - so there is no unsaved state here to
   * discard, and the stack behind should reload either way to pick up a
   * changed slide count.
   */
  close(): void {
    this.dialogRef.close(true);
  }
}
