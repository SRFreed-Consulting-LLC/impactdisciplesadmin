import { Component, Input, OnInit } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { BehaviorSubject } from 'rxjs';
import {
  PageContentBlock, PageContentItem, PageContentModel
} from '@impact-common/shared/models/domain/page-content.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { EditablePage, PageSlot } from './editable-pages';

/**
 * The editor for ONE public page's words and pictures.
 *
 * ONE component for every page rather than twelve. Which slots a page has,
 * and which fields each slot uses, is declared once in EDITABLE_PAGES - so
 * adding a page is a catalogue entry plus the matching keys in its web
 * template, and no new screen.
 *
 * Blocks are kept in a map keyed by slot, not as the stored array, because
 * the stored array may be missing slots (a page that has never been saved
 * has none at all) and may carry slots the catalogue has since dropped. On
 * save the array is rebuilt FROM THE CATALOGUE, in catalogue order.
 *
 * UNKNOWN BLOCKS ARE PRESERVED, not dropped: a key this build does not know
 * is one a newer build added, and quietly deleting staff's work because an
 * older admin loaded the page would be unrecoverable.
 *
 * A screen whose load FAILED refuses to save, for the reason the Coaching
 * with Impact screen learned on 2026-08-29: saving over content you never
 * read is how a page gets silently emptied.
 */
@Component({
  selector: 'app-page-editor',
  templateUrl: './page-editor.component.html',
  styleUrls: ['./page-editor.component.css'],
  standalone: false
})
export class PageEditorComponent implements OnInit {
  @Input({ required: true }) page!: EditablePage;

  /** The same toolbar every rich-text field in this app uses. */
  readonly richTextModules = RICH_TEXT_TOOLBAR;

  private readonly screenKey = 'page-manager';

  /** slot key -> the block being edited. Always has an entry per slot. */
  blocks: Record<string, PageContentBlock> = {};

  /** Blocks stored under keys this build does not know. Kept, never shown. */
  private unknownBlocks: PageContentBlock[] = [];

  loading = true;
  loadFailed = false;
  readonly saving$ = new BehaviorSubject<boolean>(false);

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);
  /** Which slot (and which of its cards) is picking a picture. */
  private target: { slot: string; index: number | null } | null = null;
  card: { image?: ImageModel } = {};

  constructor(
    private service: PageContentService,
    private permissionService: PermissionService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const doc = await this.service.getById(this.page.slug);
      const stored = doc?.blocks ?? [];
      const known = new Set(this.page.slots.map((slot) => slot.key));

      this.blocks = {};
      for (const slot of this.page.slots) {
        const found = stored.find((block) => block.key === slot.key);
        this.blocks[slot.key] = found
          ? { ...found, items: (found.items ?? []).map((item) => ({ ...item })) }
          : { key: slot.key, isActive: true };
      }
      this.unknownBlocks = stored.filter((block) => !known.has(block.key));
      this.loadFailed = false;
    } catch (err) {
      console.error(`Page editor: could not load ${this.page.slug}`, err);
      this.loadFailed = true;
      this.snackbar.error('Could not load this page - reload before editing');
    } finally {
      this.loading = false;
    }
  }

  // ------------------------------------------------------------------ cards

  itemsOf(slot: PageSlot): PageContentItem[] {
    const block = this.blocks[slot.key];
    if (!block.items) {
      block.items = [];
    }
    return block.items;
  }

  addItem(slot: PageSlot): void {
    this.itemsOf(slot).push({ title: '', isActive: true });
  }

  removeItem(slot: PageSlot, index: number): void {
    this.blocks[slot.key].items = this.itemsOf(slot).filter((_, i) => i !== index);
  }

  reorderItems(slot: PageSlot, event: CdkDragDrop<PageContentItem[]>): void {
    moveItemInArray(this.itemsOf(slot), event.previousIndex, event.currentIndex);
  }

  // -------------------------------------------------------- image uploader

  showImageUploader(slotKey: string, index: number | null = null): void {
    this.target = { slot: slotKey, index };
    this.card.image = index === null
      ? this.blocks[slotKey].image
      : this.blocks[slotKey].items?.[index]?.image;
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    if (this.target) {
      const block = this.blocks[this.target.slot];
      if (this.target.index === null) {
        block.image = this.card.image;
      } else if (block.items?.[this.target.index]) {
        block.items[this.target.index].image = this.card.image;
      }
    }
    this.target = null;
    this.card.image = undefined;
    this.isImageUploaderVisible$.next(false);
  }

  clearImage(slotKey: string): void {
    this.blocks[slotKey].image = undefined;
  }

  // ------------------------------------------------------------------- save

  async save(): Promise<void> {
    if (!this.canEdit() || this.loadFailed) {
      return;
    }

    this.saving$.next(true);
    // Rebuilt from the CATALOGUE so the stored order matches the page, plus
    // anything a newer build wrote that this one cannot show.
    const blocks: PageContentBlock[] = [
      ...this.page.slots.map((slot) => this.blocks[slot.key]),
      ...this.unknownBlocks
    ];

    const value = { id: this.page.slug, blocks } as PageContentModel;

    try {
      // update(), not add(): the doc id IS the page slug, so a page that has
      // never been saved must be created UNDER that id rather than a
      // generated one. FirebaseDAO.update() is a setDoc, so it creates the
      // document when it is absent - which is every page the first time.
      await this.service.update(this.page.slug, value);
      this.snackbar.success(`${this.page.label} saved`);
    } catch (err) {
      console.error(`Page editor: could not save ${this.page.slug}`, err);
      this.snackbar.error('Could not save - try again');
    } finally {
      this.saving$.next(false);
    }
  }

  canEdit(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  /** True when the slot has nothing in it yet - drawn as a hint, not an error. */
  isEmpty(slot: PageSlot): boolean {
    const block = this.blocks[slot.key];
    if (!block) {
      return true;
    }
    return !block.heading && !stripHtml(block.body) && !block.image
      && !block.ctaTitle && !(block.items ?? []).length;
  }
}

/** Whether rich text holds anything besides markup. */
export function stripHtml(html: string | undefined): string {
  return (html ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}
