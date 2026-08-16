import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule, MatCheckboxChange } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import { LibraryUser } from 'src/app/common/models/domain/library/library-user.model';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { LibraryErrorLogService } from 'src/app/common/services/data/library/library-error-log.service';

export interface LibraryGrantLicensesDialogData {
  user: LibraryUser;
}

export interface LibraryGrantLicensesDialogResult {
  granted: string[];
  grantedTitles: string[];
}

/**
 * Ported from impact-discipleship-library-manager-new's
 * dialogs/grant-licenses-dialog.component.ts. Admin "comp a license"
 * picker: every book in the library, with the ones the user already holds
 * any license for shown checked-and-disabled (a grant never overwrites
 * existing purchase/group provenance - see the grantLibraryUserLicenses
 * Cloud Function, which this calls via LibraryUserService.grantLicenses).
 * Uses LibraryBookService.getAll() (one-shot), not the source's live
 * Observable book list - matches every other Library screen's book
 * lookups in this app.
 */
@Component({
  selector: 'app-library-grant-licenses-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatCheckboxModule, MatProgressSpinnerModule],
  templateUrl: './library-grant-licenses-dialog.component.html',
  styleUrl: './library-grant-licenses-dialog.component.scss',
})
export class LibraryGrantLicensesDialogComponent {
  private readonly bookService = inject(LibraryBookService);
  private readonly libraryUserService = inject(LibraryUserService);
  private readonly errorLog = inject(LibraryErrorLogService);
  private readonly dialogRef = inject(
    MatDialogRef<LibraryGrantLicensesDialogComponent, LibraryGrantLicensesDialogResult | undefined>,
  );
  readonly data = inject<LibraryGrantLicensesDialogData>(MAT_DIALOG_DATA);

  readonly books = signal<LibraryBookModel[]>([]);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly selected = signal<ReadonlySet<string>>(new Set());

  /** Books already covered by ANY bookLicenses entry (purchase, group, or a
   *  prior admin grant) - never re-grantable from here. */
  private readonly alreadyLicensed = new Set(
    (this.data.user.bookLicenses ?? []).map((license) => license.bookId),
  );

  readonly selectedCount = computed(() => this.selected().size);

  constructor() {
    this.bookService.getAll().then((books) => {
      this.books.set(books);
      this.loading.set(false);
    });
  }

  isLicensed(bookId: string): boolean {
    return this.alreadyLicensed.has(bookId);
  }

  isSelected(bookId: string): boolean {
    return this.selected().has(bookId);
  }

  toggle(bookId: string, event: MatCheckboxChange): void {
    const next = new Set(this.selected());
    if (event.checked) {
      next.add(bookId);
    } else {
      next.delete(bookId);
    }
    this.selected.set(next);
  }

  cancel(): void {
    this.dialogRef.close();
  }

  async grant(): Promise<void> {
    const bookIds = [...this.selected()];
    if (bookIds.length === 0 || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const titlesById = new Map(this.books().map((book) => [book.id!, book.title]));
    const targetName =
      [this.data.user.firstName, this.data.user.lastName].filter(Boolean).join(' ') ||
      this.data.user.email;
    try {
      const result = await this.libraryUserService.grantLicenses(
        this.data.user.email || this.data.user.id,
        bookIds,
        targetName,
        bookIds.map((id) => titlesById.get(id) ?? id),
      );
      this.dialogRef.close({
        granted: result.granted,
        grantedTitles: result.granted.map((id) => titlesById.get(id) ?? id),
      });
    } catch (err) {
      this.errorLog.logError('LibraryGrantLicensesDialogComponent.grant', err);
      this.error.set(
        err instanceof Error ? err.message : 'Failed to grant licenses - please try again.',
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
