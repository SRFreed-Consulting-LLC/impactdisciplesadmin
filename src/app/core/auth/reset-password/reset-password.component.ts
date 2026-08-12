import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { AdminAuthService } from '../../../common/forms/admin/admin-auth.service';
import { SnackbarService } from '../../../shared/snackbar.service';

// Material replacement for the impactdisciplescommon submodule's
// ResetPasswordFormComponent (DevExtreme dx-form based).
//
// 2026-08-12 fullsweep fix: the original's onSubmit body (the actual
// AdminAuthService.resetPassword() call) was ported over commented-out, so
// clicking "Reset my password" on a validly-filled form spun forever and
// did nothing - reachable straight from the login screen's "Forgot
// password?" link. Now wired up for real; see AdminAuthService.resetPassword()
// for the matching fix to that method's own always-reports-success bug.
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

  constructor(
    private fb: FormBuilder,
    private authService: AdminAuthService,
    private snackbar: SnackbarService
  ) {
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
    this.form.disable();

    this.authService.resetPassword(this.form.get('email')?.value).pipe(
      takeUntil(this.ngUnsubscribe)
    ).subscribe((result) => {
      this.isLoading = false;
      this.form.enable();

      if (result.isOk) {
        this.snackbar.success('Check your email for a link to reset your password.');
        this.form.reset();
      } else {
        this.snackbar.error(result.message || 'Failed to send the password reset email. Please try again.');
      }
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
