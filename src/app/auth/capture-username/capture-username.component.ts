import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';

// Material replacement for the impactdisciplescommon submodule's
// CaptureUsernameFormComponent (DevExtreme dx-form based) - first screen
// of the sign-in flow. This app is always environment.application ==
// 'admin', so the original's "Login"/"Find User Account" button-text
// branch (for the 'application' app) never applied here and isn't ported.
@Component({
    selector: 'app-capture-username',
    templateUrl: './capture-username.component.html',
    styleUrls: ['../auth-form.scss', './capture-username.component.scss'],
    standalone: false
})
export class CaptureUsernameComponent implements OnDestroy {
  form: FormGroup;
  isLoading = false;

  private ngUnsubscribe = new Subject<void>();

  constructor(private fb: FormBuilder, private authService: AdminAuthService, private router: Router) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  onSubmit(): void {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    const email: string = this.form.value.email;
    this.isLoading = true;

    this.authService.findUser(email.toLowerCase()).pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      if (!user) {
        this.isLoading = false;
      } else {
        this.authService.user = user;
        this.isLoading = false;

        if (user.firebaseUID) {
          this.router.navigate(['capture-password-form']);
        } else {
          this.router.navigate(['create-auth-form']);
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
