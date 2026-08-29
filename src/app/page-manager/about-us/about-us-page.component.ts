import { Component, OnInit } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { PageContentBlock, PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import { PAGE_SECTION_TYPES } from '@impact-common/shared/lists/page_section_types.enum';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ABOUT_SECTION_KINDS, AboutSectionKind, aboutKindFor } from './about-section-catalogue';
import { AboutSectionDialogComponent } from './about-section-dialog.component';
import { PreviewDevice } from '../home/home-live-preview.component';

const SLUG = 'about-us';

/**
 * ABOUT US - the page as an ordered stack of sections, with a live preview
 * of the whole page beside it.
 *
 * The same shape as the Home screen, and for the same reason: the public
 * page is a dispatcher that renders whatever this list says, in this order,
 * so the running order is the thing staff most need to see and change.
 *
 * ORDER IS NEVER TYPED. Dropping a section reorders the array and saves;
 * the array's order IS the page's order. Nothing carries a number that
 * could disagree with its position.
 *
 * WHAT SAVES WHEN, separated on purpose:
 *   - REORDER and the LIVE toggle write immediately. They are single facts
 *     about the page, and a screen-level Save that quietly rewrote seven
 *     sections would be a surprise.
 *   - CONTENT is edited in a dialog, which saves that one section.
 *
 * A screen whose load FAILED refuses to save - saving over content it never
 * read is how a page gets silently emptied, and since these documents are
 * now the ONLY copy of this page's words there is nothing to fall back to.
 */
@Component({
  selector: 'app-about-us-page',
  templateUrl: './about-us-page.component.html',
  styleUrls: ['./about-us-page.component.css'],
  standalone: false
})
export class AboutUsPageComponent implements OnInit {
  private readonly screenKey = 'page-manager.about-us';

  readonly types = PAGE_SECTION_TYPES;

  sections: PageContentBlock[] = [];

  loading = true;
  loadFailed = false;
  readonly busy$ = new BehaviorSubject<boolean>(false);

  device: PreviewDevice = 'desktop';

  constructor(
    private service: PageContentService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const doc = await this.service.getById(SLUG);
      this.sections = (doc?.blocks ?? []).map((b) => ({ ...b }));
      this.loadFailed = false;
    } catch (err) {
      console.error('About Us: could not load the page', err);
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
      await this.service.update(SLUG, { id: SLUG, blocks: this.sections } as PageContentModel);
      this.snackbar.success(message);
    } catch (err) {
      console.error('About Us: could not save', err);
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

  get addableKinds(): AboutSectionKind[] {
    const placed = new Set(this.sections.map((s) => s.type));
    return ABOUT_SECTION_KINDS.filter((k) => !k.singleton || !placed.has(k.type));
  }

  async add(kind: AboutSectionKind): Promise<void> {
    if (!this.canEdit() || this.loadFailed) {
      return;
    }
    // Appended rather than inserted: a new section appearing in the middle
    // of the page unannounced is worse than one staff then drag.
    const section: PageContentBlock = {
      key: uniqueKey(kind.type, this.sections),
      type: kind.type,
      isActive: false,
      ...(kind.fields.entries ? { items: [] } : {})
    };
    this.sections = [...this.sections, section];
    await this.persist(`${kind.label} added - switch it on when it is ready`);
    await this.edit(section);
  }

  async edit(section: PageContentBlock): Promise<void> {
    const kind = aboutKindFor(section.type);
    if (!kind) {
      return;
    }
    const ref = this.dialog.open(AboutSectionDialogComponent, {
      width: '960px', maxWidth: '96vw', maxHeight: '94vh',
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
    const kind = aboutKindFor(section.type);
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

  kindOf(section: PageContentBlock): AboutSectionKind | undefined {
    return aboutKindFor(section.type);
  }

  /** One line saying what this section actually holds. */
  summary(section: PageContentBlock): string {
    if (section.items) {
      const live = section.items.filter((i) => i.isActive).length;
      const n = section.items.length;
      return `${n} entr${n === 1 ? 'y' : 'ies'}` + (live === n ? '' : `, ${live} showing`);
    }
    const heading = (section.heading ?? '').replace(/<[^>]+>/g, '').trim();
    if (heading) {
      return heading;
    }
    const body = (section.body ?? '').replace(/<[^>]+>/g, '').trim();
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
 * A key nothing else on the page uses.
 *
 * Keys are identity here rather than a contract - this page reads type and
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
