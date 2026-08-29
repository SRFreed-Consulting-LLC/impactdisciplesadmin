import { Component, Input, OnChanges, inject } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { PageContentBlock, PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { EditablePage, PageSectionKind, kindFor, pluralise } from './page-section-catalogue';
import { PageSectionDialogComponent } from './page-section-dialog.component';
import { PreviewDevice } from '../home/home-live-preview.component';

/**
 * ONE public page as an ordered stack of sections, with a live preview of the
 * whole page beside it.
 *
 * The same screen for all eleven, driven by that page's entry in
 * EDITABLE_PAGES. It is the shape the Home screen and About Us proved, and
 * for the same reason: every public page is a dispatcher that renders
 * whatever this list says in this order, so the running order is what staff
 * most need to see and change.
 *
 * IT REPLACED A SLOT EDITOR, which is the point of the exercise. That screen
 * showed a fixed set of named boxes - "Overview", "Cost", "Are you ready?" -
 * because the page's structure lived in its template and only its words were
 * editable. Ten of these pages could not gain a section, lose one, or put two
 * in a different order without a deploy. They can now.
 *
 * ORDER IS NEVER TYPED. Dropping a section reorders the array and saves; the
 * array's order IS the page's order. Nothing carries a number that could
 * disagree with its position.
 *
 * WHAT SAVES WHEN, separated on purpose:
 *   - REORDER and the LIVE toggle write immediately. They are single facts
 *     about the page, and a screen-level Save that quietly rewrote seven
 *     sections would be a surprise.
 *   - CONTENT is edited in a dialog, which hands back one section.
 *
 * A screen whose load FAILED refuses to save - saving over content it never
 * read is how a page gets silently emptied, and since these documents are
 * now the ONLY copy of a page's words there is nothing to fall back to.
 */
@Component({
  selector: 'app-page-stack',
  templateUrl: './page-stack.component.html',
  styleUrls: ['./page-stack.component.css'],
  standalone: false
})
export class PageStackComponent implements OnChanges {
  private readonly service = inject(PageContentService);
  private readonly permissionService = inject(PermissionService);
  private readonly dialog = inject(MatDialog);
  private readonly confirmService = inject(ConfirmService);
  private readonly snackbar = inject(SnackbarService);

  @Input({ required: true }) page!: EditablePage;

  sections: PageContentBlock[] = [];

  loading = true;
  loadFailed = false;
  readonly busy$ = new BehaviorSubject<boolean>(false);

  device: PreviewDevice = 'desktop';

  // ngOnChanges, not ngOnInit. Today Page Manager gives each tab its own @if,
  // so switching pages destroys this component and builds another - and
  // ngOnChanges fires before ngOnInit on creation, so nothing is lost either
  // way. It is written this way so that REBINDING `page` on a live instance
  // also reloads: with ngOnInit that would leave the previous page's sections
  // on screen under the new page's name, and the next save would write them
  // to the new page's document.
  ngOnChanges(): void {
    this.load();
  }

  private get screenKey(): string {
    return `page-manager.${this.page.slug}`;
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.sections = [];
    try {
      const doc = await this.service.getById(this.page.slug);
      this.sections = (doc?.blocks ?? []).map((b) => ({ ...b }));
      this.loadFailed = false;
    } catch (err) {
      console.error(`${this.page.label}: could not load the page`, err);
      this.loadFailed = true;
      this.snackbar.error('Could not load this page - reload before editing');
    } finally {
      this.loading = false;
    }
  }

  /** Writes the whole ordered list. The array IS the order. */
  private async persist(message: string): Promise<void> {
    this.busy$.next(true);
    try {
      await this.service.update(
        this.page.slug,
        { id: this.page.slug, blocks: this.sections } as PageContentModel
      );
      this.snackbar.success(message);
    } catch (err) {
      console.error(`${this.page.label}: could not save`, err);
      this.snackbar.error('Could not save that - reload and try again');
      await this.load();
    } finally {
      this.busy$.next(false);
    }
  }

  // ------------------------------------------------------------------ order

  async reorder(event: CdkDragDrop<PageContentBlock[]>): Promise<void> {
    if (!this.canEdit() || this.loadFailed || event.previousIndex === event.currentIndex) {
      return;
    }
    moveItemInArray(this.sections, event.previousIndex, event.currentIndex);
    await this.persist('Order saved');
  }

  // ----------------------------------------------------------------- toggle

  async toggleLive(section: PageContentBlock): Promise<void> {
    if (!this.canEdit() || this.loadFailed) {
      return;
    }
    const next = section.isActive === false;
    section.isActive = next;
    await this.persist(next ? 'Showing on the page' : 'Taken off the page');
  }

  // ------------------------------------------------------- add, edit, remove

  get addableKinds(): PageSectionKind[] {
    const placed = new Set(this.sections.map((s) => s.type));
    return this.page.kinds.filter((k) => !k.singleton || !placed.has(k.type));
  }

  async add(kind: PageSectionKind): Promise<void> {
    if (!this.canEdit() || this.loadFailed) {
      return;
    }
    // Appended rather than inserted: a new section appearing in the middle of
    // the page unannounced is worse than one staff then drag.
    const section: PageContentBlock = {
      key: uniqueKey(kind.type, this.sections),
      type: kind.type,
      isActive: false,
      ...(kind.fields.entries ? { items: [] } : {})
    };
    this.sections = [...this.sections, section];
    await this.persist(`${kind.label} added - switch it on when it is ready`);

    // A section with nothing to edit has no dialog to open.
    if (this.isEditable(kind)) {
      await this.edit(section);
    }
  }

  async edit(section: PageContentBlock): Promise<void> {
    const kind = this.kindOf(section);
    if (!kind || !this.isEditable(kind)) {
      return;
    }
    const ref = this.dialog.open(PageSectionDialogComponent, {
      width: '980px', maxWidth: '96vw', maxHeight: '94vh',
      data: { section: structuredClone(section), kind }
    });
    const saved: PageContentBlock | undefined = await ref.afterClosed().toPromise();
    if (!saved) {
      return;
    }
    // The dialog edits a COPY and hands it back; this screen owns the write,
    // because the document holds every section and a per-section save would
    // race the ordering.
    const i = this.sections.findIndex((s) => s.key === saved.key);
    if (i >= 0) {
      this.sections[i] = saved;
      await this.persist(`${kind.label} saved`);
    }
  }

  async remove(section: PageContentBlock): Promise<void> {
    if (!this.canDelete() || this.loadFailed) {
      return;
    }
    const kind = this.kindOf(section);
    const ok = await this.confirmService.confirm(
      'It is removed from the page and its words and pictures are gone for good. ' +
      'To take it off the page but keep it, switch Live off instead.',
      `Delete this ${kind?.label ?? 'section'}?`
    );
    if (!ok) {
      return;
    }
    this.sections = this.sections.filter((s) => s.key !== section.key);
    await this.persist(`${kind?.label ?? 'Section'} deleted`);
  }

  // ----------------------------------------------------------------- display

  kindOf(section: PageContentBlock): PageSectionKind | undefined {
    return kindFor(this.page, section.type);
  }

  /** A section with no fields of its own - the consultation banner - can be
   *  moved and switched off but has nothing to open. */
  isEditable(kind: PageSectionKind): boolean {
    return Object.keys(kind.fields).length > 0;
  }

  /** One line saying what this section actually holds. */
  summary(section: PageContentBlock): string {
    const kind = this.kindOf(section);
    if (kind && !this.isEditable(kind)) {
      return 'nothing to edit - move it or switch it off';
    }
    if (section.items) {
      const noun = kind?.entry?.noun ?? 'entry';
      const live = section.items.filter((i) => i.isActive).length;
      const n = section.items.length;
      const counted = `${n} ${pluralise(noun, n)}` + (live === n ? '' : `, ${live} showing`);
      // A block with entries usually has a heading too, and the heading is
      // what staff recognise the row by.
      const heading = plain(section.heading);
      return heading ? `${heading} — ${counted}` : counted;
    }
    const heading = plain(section.heading);
    if (heading) {
      return heading;
    }
    const body = plain(section.body);
    return body ? body.slice(0, 60) + (body.length > 60 ? '…' : '') : 'nothing in it yet';
  }

  isLive(section: PageContentBlock): boolean {
    return section.isActive !== false;
  }

  get liveCount(): number {
    return this.sections.filter((s) => this.isLive(s)).length;
  }

  /** What the public page would draw - the preview shows exactly this. */
  get liveSections(): PageContentBlock[] {
    return this.sections.filter((s) => this.isLive(s));
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

/**
 * Strips markup - a heading may carry <strong>, and a row is one line.
 *
 * A line break becomes a SPACE, like the preview's own version: a heading
 * written "Your discipleship library,<br>in your pocket." otherwise summarises
 * as "library,in your pocket".
 */
function plain(html: string | undefined): string {
  return (html ?? '')
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|ul|ol|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * A key nothing else on the page uses.
 *
 * Keys are identity here rather than a contract - a page reads type and
 * order - but they still have to be unique, because the list is tracked by
 * key and a duplicate would make two rows behave as one.
 */
export function uniqueKey(type: string, existing: readonly PageContentBlock[]): string {
  const taken = new Set(existing.map((s) => s.key));
  if (!taken.has(type)) {
    return type;
  }
  let n = 2;
  while (taken.has(`${type}-${n}`)) {
    n++;
  }
  return `${type}-${n}`;
}
