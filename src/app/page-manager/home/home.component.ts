import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatDialog } from '@angular/material/dialog';
import { Observable, map, shareReplay } from 'rxjs';
import { HomePageImageModel } from '@impact-common/shared/models/domain/home-page-image.model';
import { HomeSectionModel } from '@impact-common/shared/models/domain/home-section.model';
import { HOME_SECTION_TYPES } from '@impact-common/shared/lists/home_section_types.enum';
import { HomePageImageService } from 'src/app/common/services/data/home-page-images.service';
import { HomeSectionService } from 'src/app/common/services/data/home-sections.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { PreviewDevice } from './home-live-preview.component';
import { HOME_SECTION_KINDS, HomeSectionKind, kindFor } from './home-section-catalogue';
import { HomeSectionDialogComponent } from './home-section-dialog.component';
import { HomeSlidesDialogComponent } from './home-slides-dialog.component';

/**
 * HOME - every section the public home page renders, on one screen, in the
 * order a visitor meets them, with a live preview beside them.
 *
 * The page is DATA now (2026-08-29). Staff drag sections into a different
 * order, switch one off, add a second banner and edit what is inside each,
 * and the public site follows without a deploy. Before this the stack was
 * fixed in the web app's home.component.html with its copy, images and
 * links written into the templates.
 *
 * ORDER IS NEVER TYPED. Dropping a section renumbers every section 0..n-1
 * and writes them. That is deliberate: the slider spent years with a
 * hand-entered `order` field and production still carries three duplicate
 * pairs, which Firestore resolves in whatever sequence it likes.
 *
 * WHAT SAVES WHEN, and the two are separate on purpose:
 *   - REORDER and the LIVE toggle write immediately. They are single facts
 *     about a section, and a screen-level Save that quietly rewrote six
 *     records would be a surprise.
 *   - CONTENT is edited in a dialog, which saves that one section.
 *
 * NOT here, deliberately: the docking bar. It looks like home-page content
 * because that is where staff notice it, but the web app mounts it in
 * app.component.html and it renders on EVERY page - it is site furniture, so
 * it lives with the rest of the site-wide settings on Web Config.
 */
@Component({
  selector: 'app-page-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  standalone: false
})
export class HomeComponent implements OnInit {
  private readonly screenKey = 'page-manager.home';

  // inject() declared BEFORE anything whose initializer could need it -
  // field initializers run in order (see CLAUDE.md).
  private readonly destroyRef = inject(DestroyRef);

  readonly types = HOME_SECTION_TYPES;

  /** The stack, in page order. Held as a plain array so cdkDrag can move it. */
  sections: HomeSectionModel[] = [];

  slideTotal = 0;
  slideLive = 0;

  loading = true;
  /** Set when the first read fails, so the screen refuses to save over it. */
  loadFailed = false;

  device: PreviewDevice = 'desktop';

  /**
   * What the PUBLIC slider would show: active slides only, in order.
   *
   * Read here rather than handed up from the grid section. The grid streams
   * every slide because staff edit the switched-off ones too; the preview
   * wants exactly what a visitor gets, and deriving that from its own stream
   * keeps the two from having to know about each other. Both read the same
   * live collection, so a save updates both.
   */
  liveSlides$!: Observable<HomePageImageModel[]>;

  constructor(
    private service: HomeSectionService,
    private slideService: HomePageImageService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    const slides$ = this.slideService.streamAll().pipe(shareReplay({ bufferSize: 1, refCount: true }));

    this.liveSlides$ = slides$.pipe(
      map((slides) => slides
        .filter((slide) => slide.isActive)
        // Same sort as the web slider. Slides sharing an order number come
        // back in whatever sequence the stream gave them - which is the
        // point of the clash warning on the grid: this preview cannot show a
        // running order that the data does not actually determine.
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
    );

    // Counts for the slider row's summary. Subscribed rather than piped into
    // the template because the summary is built in TS alongside every other
    // type's; torn down with the component (sweep finding A1 - five listeners
    // here never were).
    slides$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((slides) => {
      this.slideTotal = slides.length;
      this.slideLive = slides.filter((slide) => slide.isActive).length;
    });

    this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const rows = await this.service.getAll();
      this.sections = rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      this.loadFailed = false;
    } catch (err) {
      // A screen that failed to load must not offer to write - see the
      // Coaching with Impact screen, which came up blank on 2026-08-29 for
      // exactly this reason and now refuses to save too.
      console.error('Home: could not load sections', err);
      this.loadFailed = true;
      this.snackbar.error('Could not load the page sections - reload before editing');
    } finally {
      this.loading = false;
    }
  }

  // ------------------------------------------------------------------ order

  /**
   * Renumbers every section from its position and writes the ones that
   * moved.
   *
   * Writes only what CHANGED rather than all six: a drag usually moves two
   * or three positions, and rewriting untouched records would put this
   * screen's timestamp on sections nobody edited.
   */
  async reorder(event: CdkDragDrop<HomeSectionModel[]>): Promise<void> {
    if (!this.canEdit() || this.loadFailed) {
      return;
    }

    const before = this.sections.map((section) => section.id);
    moveItemInArray(this.sections, event.previousIndex, event.currentIndex);

    const moved = this.sections
      .map((section, index) => ({ section, index }))
      .filter(({ section, index }) => before[index] !== section.id);

    try {
      await Promise.all(moved.map(({ section, index }) => {
        section.order = index;
        return this.service.update(section.id, section);
      }));
      this.snackbar.success('Order saved');
    } catch (err) {
      console.error('Home: could not save the new order', err);
      this.snackbar.error('Could not save the new order - reload and try again');
      await this.load();
    }
  }

  // ----------------------------------------------------------------- toggle

  /**
   * Live is a single fact about ONE section, so it is written straight away.
   * The switch goes back if the write fails, rather than showing a state the
   * database does not have.
   */
  async toggleLive(section: HomeSectionModel): Promise<void> {
    if (!this.canEdit() || this.loadFailed) {
      return;
    }

    const next = !section.isActive;
    section.isActive = next;

    try {
      await this.service.update(section.id, section);
      this.snackbar.success(next ? 'Showing on the page' : 'Taken off the page');
    } catch (err) {
      console.error('Home: could not change Live', err);
      section.isActive = !next;
      this.snackbar.error('Could not change that - try again');
    }
  }

  // ------------------------------------------------------- add, edit, remove

  /** Types that may still be added - a singleton already placed drops out. */
  get addableKinds(): HomeSectionKind[] {
    const placed = new Set(this.sections.map((section) => section.type));
    return HOME_SECTION_KINDS.filter((kind) => !kind.singleton || !placed.has(kind.type));
  }

  async add(kind: HomeSectionKind): Promise<void> {
    if (!this.canEdit() || this.loadFailed) {
      return;
    }

    // Appended at the end rather than inserted: a new section landing in the
    // middle of the page unannounced is worse than one staff then drag.
    const section = {
      type: kind.type,
      order: this.sections.length,
      isActive: false,
      ...(kind.fields.items ? { items: [] } : {})
    } as HomeSectionModel;

    const saved = await this.service.add(section);
    this.sections = [...this.sections, saved];
    this.snackbar.success(`${kind.label} added - switch it on when it is ready`);

    // Straight into the editor: an empty section on a live page is not
    // useful, and it is switched off until staff say otherwise.
    if (Object.keys(kind.fields).length) {
      await this.edit(saved);
    }
  }

  async edit(section: HomeSectionModel): Promise<void> {
    const kind = kindFor(section.type);
    if (!kind || !this.hasEditor(kind)) {
      return;
    }

    // The slider's content is its SLIDES, a separate collection with its own
    // grid - so it gets its own dialog rather than the field editor.
    const ref = kind.fields.slides
      ? this.dialog.open(HomeSlidesDialogComponent, {
          width: '1180px', maxWidth: '96vw', maxHeight: '94vh'
        })
      : this.dialog.open(HomeSectionDialogComponent, {
          width: '900px', maxWidth: '95vw', maxHeight: '94vh',
          data: { item: structuredClone(section), kind }
        });

    const saved = await ref.afterClosed().toPromise();
    if (saved) {
      await this.load();
    }
  }

  /** A type with no fields at all has nothing to open. */
  hasEditor(kind: HomeSectionKind): boolean {
    return Object.keys(kind.fields).length > 0;
  }

  /** Deleting a record is its own permission, not part of editing one. */
  async remove(section: HomeSectionModel): Promise<void> {
    if (!this.canDelete() || this.loadFailed) {
      return;
    }

    const kind = kindFor(section.type);
    const confirmed = await this.confirmService.confirm(
      'It is removed from the home page and its content is gone for good. ' +
      'To take it off the page but keep it, switch Live off instead.',
      `Delete this ${kind?.label ?? 'section'}?`
    );
    if (!confirmed) {
      return;
    }

    try {
      await this.service.delete(section.id);
      this.snackbar.success(`${kind?.label ?? 'Section'} deleted`);
      await this.load();
    } catch (err) {
      console.error('Home: could not delete the section', err);
      this.snackbar.error('Could not delete that - try again');
    }
  }

  // ----------------------------------------------------------------- display

  kindOf(section: HomeSectionModel): HomeSectionKind | undefined {
    return kindFor(section.type);
  }

  /**
   * The one-line summary on a section's row - what it actually holds, so the
   * stack is readable without opening anything.
   */
  summary(section: HomeSectionModel): string {
    if (section.type === HOME_SECTION_TYPES.SLIDER) {
      const slides = `${this.slideTotal} slide${this.slideTotal === 1 ? '' : 's'}`;
      return this.slideLive === this.slideTotal ? slides : `${slides}, ${this.slideLive} showing`;
    }
    if (section.items) {
      const live = section.items.filter((item) => item.isActive).length;
      return `${section.items.length} card${section.items.length === 1 ? '' : 's'}` +
        (live === section.items.length ? '' : `, ${live} showing`);
    }
    const title = (section.title ?? '').replace(/<[^>]+>/g, '').trim();
    return title || 'no heading yet';
  }

  /** An unknown type still renders a row, so staff can delete it. */
  isRenderable(section: HomeSectionModel): boolean {
    return !!kindFor(section.type);
  }

  get liveCount(): number {
    return this.sections.filter((section) => section.isActive).length;
  }

  setDevice(device: PreviewDevice): void {
    this.device = device;
  }

  canEdit(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  canDelete(): boolean {
    return this.permissionService.canDelete(this.screenKey);
  }
}
