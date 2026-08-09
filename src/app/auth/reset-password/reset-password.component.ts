import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject } from 'rxjs';

// Material replacement for the impactdisciplescommon submodule's
// ResetPasswordFormComponent (DevExtreme dx-form based).
//
// Ported as-is: the original's onSubmit body (the actual
// AdminAuthService.resetPassword() call + navigation) is entirely
// commented out already in the source being replaced, so clicking
// "Reset my password" on a validly-filled form just spins forever today
// and does nothing - that exact (non-)behavior is preserved here rather
// than being wired up, per explicit instruction to port visuals/behavior
// faithfully rather than fix functionality as part of this rebuild.
@Component({
    selector: 'app-reset-password',
    templateUrl: './reset-password.component.html',
    styleUrls: ['../auth-form.scss', './reset-password.component.scss'],
    standalone: false
})
export class ResetPasswordComponent implements OnDestroy {
  form: FormGroup;
  isLoading = false;

  private ngUnsubscribe = new Subject<void>();

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  onSubmit(): void {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    this.isLoading = true;
    // Original body intentionally left commented out upstream - see class comment.
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
