import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';

export interface LibrarySendMessageDialogData {
  /** 'all' or explicit lowercased emails - passed straight to the callable. */
  recipients: string[] | 'all';
  /** Human summary shown under the fields, e.g. "3 selected users" or
   *  "All library users (revoked users excluded)". */
  recipientLabel: string;
}

export interface LibrarySendMessageDialogResult {
  recipientCount: number;
  pushSuccessCount: number;
}

/** Limits mirror sendLibraryUserMessage's server-side validation. */
const TITLE_MAX = 120;
const BODY_MAX = 2000;

/**
 * Ported from impact-discipleship-library-manager-new's
 * dialogs/send-message-dialog.component.ts. Compose-and-send for an admin
 * announcement (see LibraryUserService.sendMessage / the
 * sendLibraryUserMessage Cloud Function): recipients get a device push
 * notification AND a persistent in-app inbox message in the reader app.
 * Opened from the Library Users list (selection or "Message all") and from
 * a single user's detail page.
 */
@Component({
  selector: 'app-library-send-message-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './library-send-message-dialog.component.html',
  styleUrl: './library-send-message-dialog.component.scss',
})
export class LibrarySendMessageDialogComponent {
  private readonly libraryUserService = inject(LibraryUserService);
  private readonly dialogRef = inject(
    MatDialogRef<LibrarySendMessageDialogComponent, LibrarySendMessageDialogResult | undefined>,
  );
  readonly data = inject<LibrarySendMessageDialogData>(MAT_DIALOG_DATA);

  readonly titleMax = TITLE_MAX;
  readonly bodyMax = BODY_MAX;
  title = '';
  body = '';
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);

  canSend(): boolean {
    return !this.sending() && this.title.trim().length > 0 && this.body.trim().length > 0;
  }

  cancel(): void {
    this.dialogRef.close();
  }

  async send(): Promise<void> {
    if (!this.canSend()) {
      return;
    }
    this.sending.set(true);
    this.error.set(null);
    try {
      const result = await this.libraryUserService.sendMessage(
        this.data.recipients,
        this.title.trim(),
        this.body.trim(),
      );
      this.dialogRef.close({
        recipientCount: result.recipientCount,
        pushSuccessCount: result.pushSuccessCount,
      });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to send - please try again.');
    } finally {
      this.sending.set(false);
    }
  }
}
