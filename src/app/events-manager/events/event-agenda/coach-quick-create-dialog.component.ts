import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { CoachModel } from '@impact-common/shared/models/domain/coach.model';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { SnackbarService } from '../../../shared/snackbar.service';

// "+ Add new coach to this event" - the Summit screen's quick-create,
// deliberately much lighter than the full CoachDialogComponent (whose
// required organization select and full address/phone/bio form stay on the
// standalone edit-only Coaches screen): mid-agenda-building you know the
// person's name and maybe their title, nothing more. This is now the ONLY
// place a new coach gets created (user decision, 2026-08 restructure) -
// bio/photo/organization get filled in later on Events Manager > Coaches.
@Component({
    selector: 'app-coach-quick-create-dialog',
    templateUrl: './coach-quick-create-dialog.component.html',
    styleUrls: ['./coach-quick-create-dialog.component.scss'],
    standalone: false
})
export class CoachQuickCreateDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);

  constructor(
    private dialogRef: MatDialogRef<CoachQuickCreateDialogComponent, CoachModel | undefined>,
    private fb: FormBuilder,
    private coachService: CoachService,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      title: ['']
    });
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  async onSave(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.inProgress$.next(true);
    try {
      const v = this.form.value;
      const coach = await this.coachService.add({
        firstName: v.firstName,
        lastName: v.lastName,
        fullname: `${v.firstName} ${v.lastName}`,
        title: v.title ?? '',
        isActive: true
      } as CoachModel);
      this.snackbar.success('Coach Added');
      this.dialogRef.close(coach);
    } catch {
      this.snackbar.error('Some Error Occured');
      this.inProgress$.next(false);
    }
  }
}
