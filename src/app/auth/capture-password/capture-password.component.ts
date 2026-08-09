import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';

// Material replacement for the impactdisciplescommon submodule's
// CapturePasswordFormComponent (DevExtreme dx-form based) - second/final
// screen of the sign-in flow. Uses this app's own SnackbarService instead
// of devextreme/ui/notify for the login-failure message.
@Component({
    selector: 'app-capture-password',
    templateUrl: './capture-password.component.html',
    styleUrls: ['../auth-form.scss', './capture-password.component.scss'],
    standalone: false
})
export class CapturePasswordComponent implements OnDestroy {
  form: FormGroup;
  isLoading = false;

  private ngUnsubscribe = new Subject<void>();

  constructor(private fb: FormBuilder, private authService: AdminAuthService, private snackbar: SnackbarService) {
    this.form = this.fb.group({
      password: ['', Validators.required]
    });
  }

  onSubmit(): void {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    const password: string = this.form.value.password;
    const email: string = this.authService.user?.email;
    this.isLoading = true;

    this.authService.logIn(email, password).pipe(takeUntil(this.ngUnsubscribe)).subscribe((result) => {
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
