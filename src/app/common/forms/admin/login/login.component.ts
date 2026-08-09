import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { AdminAuthService } from '../admin-auth.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';

// Replaces the old 2-step capture-username -> capture-password flow with a
// single combined email+password form, matching impact-discipleship-library-
// manager-new's app-login (single form, no "Forgot password"/"Create
// Account" of its own). This app still needs both of those, so "Forgot
// password?" links to the existing /reset-password screen (kept as-is), and
// Create Account has been removed outright per explicit instruction - there
// is currently no other path in this app that provisions a new Admin User's
// first Firebase Auth password; see AdminAuthService's class comment.
//
// Calls AdminAuthService.logIn() directly instead of the old findUser() ->
// route-to-capture-password dance - logIn() already re-queries admin_users
// by email after Firebase Auth succeeds and handles the "no matching
// account"/wrong-password/too-many-requests cases via its own notify()
// toasts, so no separate pre-check step is needed here.
@Component({
    selector: 'app-login',
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.scss'],
    standalone: false
})
export class LoginComponent implements OnDestroy {
  form: FormGroup;
  isLoading = false;

  private ngUnsubscribe = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private authService: AdminAuthService,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  onSubmit(): void {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    const { email, password } = this.form.value;
    this.isLoading = true;

    this.authService.logIn(email.toLowerCase(), password).pipe(takeUntil(this.ngUnsubscribe)).subscribe((result) => {
      if (!result.isOk) {
        this.snackbar.error('There was an error trying to log in: ' + result.message);
      }

      this.isLoading = false;
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
