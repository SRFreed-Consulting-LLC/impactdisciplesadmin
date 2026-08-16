import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { LibraryDailyReadingPlan } from 'src/app/common/services/data/library/library-lesson.service';

export interface DailyReadingDialogData {
  plan: LibraryDailyReadingPlan;
}

// Ported from impact-discipleship-library-manager-new's
// features/lesson-editor/daily-reading-dialog.component.ts.
@Component({
  selector: 'app-daily-reading-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './daily-reading-dialog.component.html',
  styleUrl: './daily-reading-dialog.component.scss',
})
export class DailyReadingDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<DailyReadingDialogComponent, LibraryDailyReadingPlan>);
  readonly data = inject<DailyReadingDialogData>(MAT_DIALOG_DATA);

  readonly form = this.fb.nonNullable.group({
    showDailyReading: [this.data.plan.showDailyReading ?? false],
    memoryVerse: [this.data.plan.memoryVerse ?? ''],
    goal: [this.data.plan.goal ?? ''],
    dailyReadingVerse: [this.data.plan.dailyReadingVerse ?? ''],
    monVerse: [this.data.plan.monVerse ?? ''],
    tueVerse: [this.data.plan.tueVerse ?? ''],
    wedVerse: [this.data.plan.wedVerse ?? ''],
    thuVerse: [this.data.plan.thuVerse ?? ''],
    friVerse: [this.data.plan.friVerse ?? ''],
  });

  submit(): void {
    this.dialogRef.close(this.form.getRawValue());
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
