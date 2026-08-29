import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { BehaviorSubject } from 'rxjs';
import {
  PageContentBlock, PageContentItem
} from '@impact-common/shared/models/domain/page-content.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import menuData from 'src/app/common/services/data/nav-menu-data';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import {
  EntryFields, EntrySpec, GIVING_DESTINATIONS, ICON_CHOICES, PageSectionKind,
  WEB_CONFIG_AMOUNTS, pluralise
} from './page-section-catalogue';

export interface PageSectionDialogData {
  section: PageContentBlock;
  kind: PageSectionKind;
}

/**
 * Edits ONE section of ONE public page.
 *
 * One dialog for every type on every page: which fields a type uses, and what
 * they are called on that page, is declared once in the catalogue - so a new
 * section type that reuses existing fields needs no change here.
 *
 * It does NOT save. It edits a copy and hands it back on close, and the stack
 * screen writes it - because the whole page is one document and a per-section
 * write would race the ordering. That is the difference from
 * BaseEntityDialogComponent, which owns its own save; extending it here would
 * mean two writers for one document.
 *
 * Order and Live are not here either. They are single facts the stack writes
 * the moment they change.
 */
@Component({
    selector: 'app-page-section-dialog',
    templateUrl: './page-section-dialog.component.html',
    styleUrls: ['./page-section-dialog.component.css'],
    standalone: false
})
export class PageSectionDialogComponent {
  readonly richTextModules = RICH_TEXT_TOOLBAR;
  readonly amounts = WEB_CONFIG_AMOUNTS;
  readonly givingDestinations = GIVING_DESTINATIONS;
  readonly icons = ICON_CHOICES;

  readonly section: PageContentBlock;
  readonly kind: PageSectionKind;

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);
  /** Which entry is picking a picture, or null for the section's own. */
  private target: number | null = null;
  card: { image?: ImageModel } = {};

  destinations: { text: string; value: string }[] = [];

  // inject() runs in FIELD INITIALIZER order, so anything a later field
  // depends on has to be declared before it - see CLAUDE.md. These two are
  // read in the constructor, which runs after every initializer, so order
  // between them does not matter.
  private readonly dialogRef =
    inject<MatDialogRef<PageSectionDialogComponent, PageContentBlock | undefined>>(MatDialogRef);

  constructor() {
    const data = inject<PageSectionDialogData>(MAT_DIALOG_DATA);
    this.section = data.section;
    this.kind = data.kind;
    if (this.kind.fields.entries && !this.section.items) {
      this.section.items = [];
    }

    menuData.forEach((menu) => {
      this.destinations.push({ text: menu.title, value: menu.link });
      if (menu.hasDropdown) {
        menu.dropdownItems.forEach((dd) => {
          this.destinations.push({ text: dd.title, value: dd.link });
        });
      }
    });
    // An anchor is a real destination: the About Us story buttons all point
    // at #history, which is the banner further down that same page.
    this.destinations.push({ text: 'The banner on this page', value: '#history' });
    this.destinations.push({ text: 'External', value: 'external' });
  }

  get fields() {
    return this.kind.fields;
  }

  get entrySpec(): EntrySpec | undefined {
    return this.kind.entry;
  }

  get entryFields(): EntryFields {
    return this.kind.entry?.fields ?? {};
  }

  get headingLabel(): string {
    return this.kind.headingLabel ?? 'Heading';
  }

  get subheadingLabel(): string {
    return this.kind.subheadingLabel ?? 'Second heading';
  }

  get bodyLabel(): string {
    return this.kind.bodyLabel ?? 'Copy';
  }

  get imageLabel(): string {
    return this.kind.imageLabel ?? 'Picture';
  }

  get noteLabel(): string {
    return this.kind.noteLabel ?? 'Small line';
  }

  get ctaLabel(): string {
    return this.kind.ctaLabel ?? 'Button text';
  }

  get cta2Label(): string {
    return this.kind.cta2Label ?? 'Second button text';
  }

  // ---------------------------------------------------------- the entries

  get entries(): PageContentItem[] {
    return this.section.items ?? [];
  }

  get entryNoun(): string {
    return this.entrySpec?.noun ?? 'entry';
  }

  /** "Entries", not "Entrys" - see pluralise(). */
  get entryNounPlural(): string {
    return pluralise(this.entryNoun, 2);
  }

  addEntry(): void {
    // A two-column list defaults a new passage to the left, which is where
    // the eye goes first and where staff can see it landed.
    const seed: PageContentItem = {
      title: '', isActive: true,
      ...(this.entryFields.column ? { column: 'left' as const } : {})
    };
    this.section.items = [...this.entries, seed];
  }

  removeEntry(index: number): void {
    this.section.items = this.entries.filter((_, i) => i !== index);
  }

  reorderEntries(event: CdkDragDrop<PageContentItem[]>): void {
    moveItemInArray(this.entries, event.previousIndex, event.currentIndex);
  }

  /**
   * Which side this entry lands on - DERIVED, never stored.
   *
   * Shown so the editor does not hide a layout rule the page applies: an
   * order that silently changes which side a photo sits on looks like a bug
   * until you know it is the rule.
   *
   * Counted among entries of the same COLUMN where there is one, so a
   * two-column block does not claim an alternation it does not have (it
   * returns nothing there - it does not alternate at all).
   */
  sideOf(index: number): string {
    const labels = this.entrySpec?.sideLabels;
    if (!labels) {
      return '';
    }
    return labels[index % 2];
  }

  /** The "01", "02" chip a numbered list draws, counted here exactly as the
   *  public page counts it. */
  chipOf(index: number): string {
    return String(index + 1).padStart(2, '0');
  }

  // --------------------------------------------------------- the uploader

  showImageUploader(index: number | null = null): void {
    this.target = index;
    this.card.image = index === null ? this.section.image : this.entries[index]?.image;
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    if (this.target === null) {
      this.section.image = this.card.image;
    } else if (this.entries[this.target]) {
      this.entries[this.target].image = this.card.image;
    }
    this.target = null;
    this.card.image = undefined;
    this.isImageUploaderVisible$.next(false);
  }

  clearImage(): void {
    this.section.image = undefined;
  }

  // ---------------------------------------------------------------- close

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onSave(): void {
    if (this.fields.video) {
      this.section.videoId = parseVideoId(this.section.videoUrl);
    }
    this.dialogRef.close(this.section);
  }
}

/**
 * The bare YouTube id out of whatever staff pasted - a watch URL, a share
 * link, an embed URL, or an id on its own. Parsed on save so the public
 * page never has to.
 */
export function parseVideoId(input: string | undefined): string | undefined {
  const value = (input ?? '').trim();
  if (!value) {
    return undefined;
  }
  if (/^[\w-]{11}$/.test(value)) {
    return value;
  }
  const match = value.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/
  );
  return match ? match[1] : undefined;
}
