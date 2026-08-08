import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialogComponent } from './confirm-dialog.component';

/**
 * Material replacement for devextreme/ui/dialog's confirm(). Matches its
 * call shape - confirm(message, title).then(result => ...) - so call sites
 * migrate with a minimal diff: confirm(msg, title) -> confirmService.confirm(msg, title).
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  constructor(private dialog: MatDialog) {}

  confirm(message: string, title = 'Confirm'): Promise<boolean> {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '360px',
      data: { message, title }
    });

    return firstValueFrom(dialogRef.afterClosed()).then((result) => !!result);
  }
}
