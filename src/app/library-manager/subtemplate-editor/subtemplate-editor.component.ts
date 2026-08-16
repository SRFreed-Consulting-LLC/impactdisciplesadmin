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
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { LibraryLessonImageService } from 'src/app/common/services/data/library/library-lesson-image.service';
import { LibrarySubtemplateService } from 'src/app/common/services/data/library/library-subtemplate.service';
import { ensureLibraryFormioComponentsRegistered } from 'src/app/common/services/data/library/library-formio-registration.util';
import { ensureLibraryVendorStylesheet } from 'src/app/common/services/data/library/library-vendor-stylesheet.util';
import { LibraryFormioSchema } from 'src/app/common/models/domain/library/library-lesson.model';
import {
  LibrarySubtemplateModel,
  LibrarySubtemplateType,
} from 'src/app/common/models/domain/library/library-subtemplate.model';

const EMPTY_SCHEMA: LibraryFormioSchema = { display: 'form', components: [] };

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/subtemplate-editor/subtemplate-editor.component.ts.
 *
 * TreeLockService is NOT ported - the source app needed it because its own
 * treeview sidebar could navigate away from this page bypassing the
 * CanDeactivate guard. This app's left nav is a plain Angular Router
 * `routerLink` like every other navigation, so `subtemplateEditorCanDeactivateGuard`
 * alone already covers it - no separate lock mechanism needed.
 */
@Component({
  selector: 'app-subtemplate-editor',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './subtemplate-editor.component.html',
  styleUrl: './subtemplate-editor.component.scss',
})
export class SubtemplateEditorComponent implements OnInit, OnDestroy {
  @ViewChild('builderContainer', { static: true }) builderContainer!: ElementRef<HTMLDivElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly subtemplates = inject(LibrarySubtemplateService);
  private readonly lessonImages = inject(LibraryLessonImageService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirmService = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  subtemplateId!: string;
  readonly subtemplate = signal<LibrarySubtemplateModel | undefined>(undefined);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly type = signal<LibrarySubtemplateType>('layout');
  readonly titleDraft = signal('');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private builder: any;
  private lastSavedSchema = '';
  private lastSavedTitle = '';
  private lastSavedType: LibrarySubtemplateType = 'layout';

  // Set when opened via the "+" button on the Lesson Template screen (a
  // later Slice 2 sub-step, not built yet) - Save/Cancel will return there
  // instead of to the plain subtemplates list once it exists.
  private returnTo: string | null = null;
  private returnSlot: string | null = null;

  constructor() {
    ensureLibraryFormioComponentsRegistered();
    ensureLibraryVendorStylesheet('bootstrap.min.css');
    ensureLibraryVendorStylesheet('formio.full.min.css');
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id) {
        void this.loadSubtemplate(id);
      }
    });
  }

  private async loadSubtemplate(id: string): Promise<void> {
    this.subtemplateId = id;
    this.loading.set(true);
    this.loadError.set(null);
    this.returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    this.returnSlot = this.route.snapshot.queryParamMap.get('returnSlot');

    try {
      const subtemplate = await this.subtemplates.getById(id);
      this.subtemplate.set(subtemplate);
      this.titleDraft.set(subtemplate?.title ?? '');
      this.type.set(subtemplate?.type ?? 'layout');

      const hydratedSchema =
        (await this.lessonImages.hydrateSchema(subtemplate?.formSchema ?? null)) ?? EMPTY_SCHEMA;

      this.builder?.instance?.destroy?.();
      this.builder = await Formio.builder(
        this.builderContainer.nativeElement,
        hydratedSchema,
        { builder: { premium: false }, noDefaultSubmitButton: true },
      );
      this.lastSavedSchema = JSON.stringify(this.builder.schema);
      this.lastSavedTitle = this.titleDraft();
      this.lastSavedType = this.type();
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : String(err));
      console.error('SubtemplateEditorComponent failed to load subtemplate', id, err);
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.builder?.instance?.destroy?.();
  }

  hasUnsavedChanges(): boolean {
    return (
      !!this.builder &&
      (JSON.stringify(this.builder.schema) !== this.lastSavedSchema ||
        this.titleDraft() !== this.lastSavedTitle ||
        this.type() !== this.lastSavedType)
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
    if (!this.builder) {
      return;
    }
    this.saving.set(true);
    try {
      const schema = this.builder.schema as LibraryFormioSchema;
      const dehydratedSchema = await this.lessonImages.dehydrateSchema(schema);
      const title = this.titleDraft().trim() || this.subtemplate()?.title || '';
      await this.subtemplates.saveSubtemplateForm(this.subtemplateId, dehydratedSchema, this.type(), title);
      this.lastSavedSchema = JSON.stringify(schema);
      this.lastSavedTitle = this.titleDraft();
      this.lastSavedType = this.type();
      this.snackBar.open('Subtemplate saved.', 'Dismiss', { duration: 3000 });
      if (this.returnTo) {
        void this.router.navigate([this.returnTo], {
          queryParams: { newSubtemplateId: this.subtemplateId, returnSlot: this.returnSlot },
        });
      } else {
        // "Subtemplates" is a tab within the Library Manager shell (see
        // NAV_CONFIG), not its own path - selected via ?tab=<slug>, same as
        // every other manager's tab-shell screens.
        void this.router.navigate(['/library-manager'], { queryParams: { tab: 'subtemplates' } });
      }
    } finally {
      this.saving.set(false);
    }
  }

  async cancel(): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'Discard changes and return to subtemplates? Anything unsaved will be lost.',
      'Discard changes?',
    );
    if (confirmed) {
      if (this.returnTo) {
        void this.router.navigate([this.returnTo]);
      } else {
        void this.router.navigate(['/library-manager'], { queryParams: { tab: 'subtemplates' } });
      }
    }
  }
}
