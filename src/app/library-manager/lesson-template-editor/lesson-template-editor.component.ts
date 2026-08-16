import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Formio } from '@formio/js';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { LibraryLessonImageService } from 'src/app/common/services/data/library/library-lesson-image.service';
import { LibraryLessonTemplateService } from 'src/app/common/services/data/library/library-lesson-template.service';
import { LibrarySubtemplateService } from 'src/app/common/services/data/library/library-subtemplate.service';
import { flattenLessonTemplateComponents } from 'src/app/common/services/data/library/library-template-merge.util';
import { ensureLibraryFormioComponentsRegistered } from 'src/app/common/services/data/library/library-formio-registration.util';
import { ensureLibraryVendorStylesheet } from 'src/app/common/services/data/library/library-vendor-stylesheet.util';
import { LibraryLessonTemplateModel } from 'src/app/common/models/domain/library/library-lesson-template.model';
import {
  LibrarySubtemplateModel,
  LibrarySubtemplateType,
} from 'src/app/common/models/domain/library/library-subtemplate.model';
import { CreateItemDialogComponent } from '../dialogs/create-item-dialog.component';

// Same null-vs-empty-string sentinel trick as the source component - see its
// own comment on mat-select's null handling.
const NONE_SLOT = '';

const TYPE_LABELS: Record<LibrarySubtemplateType, string> = {
  header: 'Header',
  layout: 'Layout',
  footer: 'Footer',
};

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/lesson-templates/lesson-template-editor.component.ts.
 * flattenLessonTemplateComponents() (used at lesson-creation time to apply a
 * template) is NOT ported yet - lesson creation itself is a later slice
 * (Browse has no "New Lesson" flow yet). This screen only composes/previews
 * templates for later use.
 *
 * TreeLockService not ported - see SubtemplateEditorComponent's identical note.
 */
@Component({
  selector: 'app-lesson-template-editor',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './lesson-template-editor.component.html',
  styleUrl: './lesson-template-editor.component.scss',
})
export class LessonTemplateEditorComponent implements OnInit, OnDestroy {
  @ViewChild('previewContainer', { static: true }) previewContainer!: ElementRef<HTMLDivElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lessonTemplates = inject(LibraryLessonTemplateService);
  private readonly lessonImages = inject(LibraryLessonImageService);
  private readonly subtemplateService = inject(LibrarySubtemplateService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly confirmService = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  lessonTemplateId!: string;
  readonly lessonTemplate = signal<LibraryLessonTemplateModel | undefined>(undefined);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly titleDraft = signal('');

  readonly headerSubtemplates = signal<LibrarySubtemplateModel[]>([]);
  readonly layoutSubtemplates = signal<LibrarySubtemplateModel[]>([]);
  readonly footerSubtemplates = signal<LibrarySubtemplateModel[]>([]);

  readonly headerSubtemplateId = signal<string>(NONE_SLOT);
  readonly layoutSubtemplateId = signal<string>(NONE_SLOT);
  readonly footerSubtemplateId = signal<string>(NONE_SLOT);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private previewForm: any;

  private lastSavedTitle = '';
  private lastSavedHeaderSlot = NONE_SLOT;
  private lastSavedLayoutSlot = NONE_SLOT;
  private lastSavedFooterSlot = NONE_SLOT;

  constructor() {
    ensureLibraryFormioComponentsRegistered();
    ensureLibraryVendorStylesheet('bootstrap.min.css');
    ensureLibraryVendorStylesheet('formio.full.min.css');
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id) {
        void this.load(id);
      }
    });
  }

  private async load(id: string): Promise<void> {
    this.lessonTemplateId = id;
    this.loading.set(true);
    this.loadError.set(null);

    try {
      const [lessonTemplate, allSubtemplates] = await Promise.all([
        this.lessonTemplates.getById(id),
        this.subtemplateService.getAll(),
      ]);
      this.lessonTemplate.set(lessonTemplate);
      this.titleDraft.set(lessonTemplate?.title ?? '');

      const headerSubtemplates = allSubtemplates.filter((t) => t.type === 'header');
      const layoutSubtemplates = allSubtemplates.filter((t) => t.type === 'layout');
      const footerSubtemplates = allSubtemplates.filter((t) => t.type === 'footer');
      this.headerSubtemplates.set(headerSubtemplates);
      this.layoutSubtemplates.set(layoutSubtemplates);
      this.footerSubtemplates.set(footerSubtemplates);

      this.headerSubtemplateId.set(this.resolveSlot(lessonTemplate?.headerSubtemplateId, headerSubtemplates));
      this.layoutSubtemplateId.set(this.resolveSlot(lessonTemplate?.layoutSubtemplateId, layoutSubtemplates));
      this.footerSubtemplateId.set(this.resolveSlot(lessonTemplate?.footerSubtemplateId, footerSubtemplates));

      this.lastSavedTitle = this.titleDraft();
      this.lastSavedHeaderSlot = this.headerSubtemplateId();
      this.lastSavedLayoutSlot = this.layoutSubtemplateId();
      this.lastSavedFooterSlot = this.footerSubtemplateId();

      // A subtemplate just created from this screen (see createSubtemplate())
      // comes back here via these query params.
      const queryParams = this.route.snapshot.queryParamMap;
      const newSubtemplateId = queryParams.get('newSubtemplateId');
      const returnSlot = queryParams.get('returnSlot') as LibrarySubtemplateType | null;
      if (newSubtemplateId && returnSlot) {
        this.setSlot(returnSlot, newSubtemplateId);
        void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      }

      await this.renderPreview();
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : String(err));
      console.error('LessonTemplateEditorComponent failed to load', id, err);
    } finally {
      this.loading.set(false);
    }
  }

  private resolveSlot(id: string | null | undefined, matchingSubtemplates: LibrarySubtemplateModel[]): string {
    if (!id || !matchingSubtemplates.some((t) => t.id === id)) {
      return NONE_SLOT;
    }
    return id;
  }

  private setSlot(type: LibrarySubtemplateType, id: string): void {
    if (type === 'header') {
      this.headerSubtemplateId.set(id);
    } else if (type === 'layout') {
      this.layoutSubtemplateId.set(id);
    } else {
      this.footerSubtemplateId.set(id);
    }
  }

  ngOnDestroy(): void {
    this.previewForm?.destroy?.();
  }

  onHeaderChange(id: string): void {
    this.headerSubtemplateId.set(id);
    void this.renderPreview();
  }

  onLayoutChange(id: string): void {
    this.layoutSubtemplateId.set(id);
    void this.renderPreview();
  }

  onFooterChange(id: string): void {
    this.footerSubtemplateId.set(id);
    void this.renderPreview();
  }

  private async renderPreview(): Promise<void> {
    const header = this.headerSubtemplates().find((t) => t.id === this.headerSubtemplateId());
    const layout = this.layoutSubtemplates().find((t) => t.id === this.layoutSubtemplateId());
    const footer = this.footerSubtemplates().find((t) => t.id === this.footerSubtemplateId());
    // Always header -> layout -> footer, regardless of pick order - mirrors
    // what actually happens when this lesson template gets applied to a new
    // lesson (a later slice, once Browse gains a "New Lesson" flow).
    const schema = flattenLessonTemplateComponents(header?.formSchema, layout?.formSchema, footer?.formSchema);
    const hydratedSchema = (await this.lessonImages.hydrateSchema(schema)) ?? schema;

    this.previewForm?.destroy?.();
    this.previewForm = await Formio.createForm(this.previewContainer.nativeElement, hydratedSchema, {
      readOnly: true,
    });
  }

  private async persistSlots(): Promise<void> {
    const title = this.titleDraft().trim() || this.lessonTemplate()?.title || '';
    await this.lessonTemplates.saveLessonTemplateSlots(
      this.lessonTemplateId,
      {
        headerSubtemplateId: this.headerSubtemplateId() || null,
        layoutSubtemplateId: this.layoutSubtemplateId() || null,
        footerSubtemplateId: this.footerSubtemplateId() || null,
      },
      title,
    );
    this.lastSavedTitle = this.titleDraft();
    this.lastSavedHeaderSlot = this.headerSubtemplateId();
    this.lastSavedLayoutSlot = this.layoutSubtemplateId();
    this.lastSavedFooterSlot = this.footerSubtemplateId();
  }

  hasUnsavedChanges(): boolean {
    return (
      this.titleDraft() !== this.lastSavedTitle ||
      this.headerSubtemplateId() !== this.lastSavedHeaderSlot ||
      this.layoutSubtemplateId() !== this.lastSavedLayoutSlot ||
      this.footerSubtemplateId() !== this.lastSavedFooterSlot
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      await this.persistSlots();
      this.snackBar.open('Lesson template saved.', 'Dismiss', { duration: 3000 });
      void this.router.navigate(['/library-manager'], { queryParams: { tab: 'lesson-templates' } });
    } finally {
      this.saving.set(false);
    }
  }

  async createSubtemplate(type: LibrarySubtemplateType): Promise<void> {
    const label = TYPE_LABELS[type];
    const ref = this.dialog.open(CreateItemDialogComponent, {
      data: { title: `New ${label} Subtemplate`, label: `${label} subtemplate name` },
      width: '400px',
    });
    const name: string | undefined = await firstValueFrom(ref.afterClosed());
    if (!name) {
      return;
    }

    // Persist whatever's currently selected before navigating away to build
    // the new subtemplate - this screen has no unsaved-changes guard here,
    // so leaving without saving would otherwise silently drop any other slot
    // already picked.
    await this.persistSlots();

    const newSubtemplateId = await this.subtemplateService.createSubtemplate(name, type);
    void this.router.navigate(['/library-manager/subtemplates', newSubtemplateId], {
      queryParams: {
        returnTo: `/library-manager/lesson-templates/${this.lessonTemplateId}`,
        returnSlot: type,
      },
    });
  }

  async cancel(): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'Discard changes and return to lesson templates? Anything unsaved will be lost.',
      'Discard changes?',
    );
    if (confirmed) {
      void this.router.navigate(['/library-manager'], { queryParams: { tab: 'lesson-templates' } });
    }
  }
}
