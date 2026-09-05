import { Component, Inject, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { PageContentItem } from '@impact-common/shared/models/domain/page-content.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import {
  EntryFields, EntrySpec, GIVING_DESTINATIONS, ICON_CHOICES, WEB_CONFIG_AMOUNTS
} from './page-section-catalogue';

export interface PageEntryDialogData {
  /** The entry to edit. NOT the live one - see the component's own note. */
  entry: PageContentItem;
  spec: EntrySpec;
  /** Its position in the list, for the counted chip and the derived side. */
  index: number;
  chip: string;
  side: string;
  isNew: boolean;
}

/**
 * ONE ENTRY, IN A DIALOG.
 *
 * Every list in a section used to hold its fields open, all of them, all at
 * once: a picture button, a title, a headline, a paragraph, a rich-text box, a
 * destination and a pair of button fields for each of eight rows. Finding the
 * third coach meant scrolling past two full forms, and the list stopped being
 * a list - there was nothing to read down.
 *
 * So the row now identifies the entry and nothing else, and this is where its
 * fields live (owner, 2026-09-05).
 *
 * IT EDITS A COPY. The live preview beside the editor cannot be seen behind a
 * dialog, so the argument for writing straight through to the section - that
 * you watch the page change as you type - is gone, and what is left is the
 * ordinary expectation that Cancel undoes what you typed. The copy is made by
 * the opener, which is also what applies it, so nothing here has to know how a
 * section is saved.
 */
@Component({
  selector: 'app-page-entry-dialog',
  templateUrl: './page-entry-dialog.component.html',
  styleUrls: ['./page-entry-dialog.component.css'],
  standalone: false
})
export class PageEntryDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<PageEntryDialogComponent, PageContentItem | undefined>>(MatDialogRef);

  readonly entry: PageContentItem;
  readonly spec: EntrySpec;
  readonly fields: EntryFields;

  readonly icons = ICON_CHOICES;
  readonly amounts = WEB_CONFIG_AMOUNTS;
  readonly givingDestinations = GIVING_DESTINATIONS;
  readonly richTextModules = RICH_TEXT_TOOLBAR;

  constructor(@Inject(MAT_DIALOG_DATA) public data: PageEntryDialogData) {
    this.entry = data.entry;
    this.spec = data.spec;
    this.fields = data.spec.fields ?? {};
  }

  get title(): string {
    const noun = this.spec.noun;
    return this.data.isNew ? `New ${noun}` : `Edit this ${noun}`;
  }

  save(): void {
    this.dialogRef.close(this.entry);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }

  // ------------------------------------------------------------ the picture
  //
  // The uploader is a fixed backdrop that draws itself ABOVE a Material
  // dialog (see its own header comment), so it works from in here unchanged.
  // `card` is the staging object it writes into - never the entry, so a
  // cancelled pick leaves nothing behind.

  card: { image?: ImageModel } = {};
  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  showImageUploader(): void {
    this.card.image = this.entry.image;
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    // Never `image: undefined` - a key explicitly set to undefined rejects
    // the whole Firestore write. Absent or a real value, nothing between.
    if (this.card.image) {
      this.entry.image = this.card.image;
    } else {
      delete this.entry.image;
    }
    this.card.image = undefined;
    this.isImageUploaderVisible$.next(false);
  }

  clearImage(): void {
    delete this.entry.image;
    delete this.entry.photoFocusPoint;
  }

  // --------------------------------------------------------- the focal point
  //
  // Moved here with the picture it belongs to. The list used to open one of
  // these at a time and hide the rest, because eight open drag targets is a
  // wall of photographs - a concern that disappears when only one entry is
  // open at all.

  /** This entry's point, defaulting to the middle. */
  get focusPoint(): { x: number; y: number } {
    const point = this.entry.photoFocusPoint;
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ?
      { x: point.x, y: point.y } : { x: 50, y: 50 };
  }

  /**
   * Moves the focal point to the pointer.
   * @param event The pointer event on the picture.
   */
  moveFocus(event: PointerEvent): void {
    const el = event.currentTarget as HTMLElement | null;
    if (!el) {
      return;
    }
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) {
      return;
    }
    const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
    this.entry.photoFocusPoint = {
      x: pct(((event.clientX - box.left) / box.width) * 100),
      y: pct(((event.clientY - box.top) / box.height) * 100)
    };
  }

  startFocusDrag(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.moveFocus(event);
  }

  dragFocus(event: PointerEvent): void {
    if (event.buttons === 1) {
      this.moveFocus(event);
    }
  }

  /** Keyboard equivalent - a drag is unreachable without a pointer.
   * @param dx Sideways nudge, in percent.
   * @param dy Vertical nudge, in percent. */
  nudgeFocus(dx: number, dy: number): void {
    const { x, y } = this.focusPoint;
    const clamp = (n: number) => Math.min(100, Math.max(0, n));
    this.entry.photoFocusPoint = { x: clamp(x + dx), y: clamp(y + dy) };
  }

  /** Back to the card's own default - the ABSENCE of a point, not a centred
   *  one, so the card keeps whatever crop it was designed with. */
  clearFocus(): void {
    delete this.entry.photoFocusPoint;
  }
}
