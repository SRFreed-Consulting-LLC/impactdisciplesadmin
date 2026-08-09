import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { LoggerService } from 'src/app/common/services/data/logger.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';

// Material replacement for the impactdisciplescommon submodule's
// CreateAuthFormComponent (DevExtreme dx-form based) - shown when
// capture-username finds a Customer record with no firebaseUID yet.
// Uses this app's own SnackbarService instead of devextreme/ui/notify.
//
// Note: the original shows the password-mismatch message as a 'success'
// (green) toast rather than an 'error' one - almost certainly a copy-paste
// bug, but ported as-is for behavioral fidelity rather than silently fixed.
@Component({
    selector: 'app-create-account',
    templateUrl: './create-account.component.html',
    styleUrls: ['../auth-form.scss', './create-account.component.scss'],
    standalone: false
})
export class CreateAccountComponent implements OnDestroy {
  form: FormGroup;
  isLoading = false;

  private ngUnsubscribe = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private authService: AdminAuthService,
    private userService: AdminUserService,
    private router: Router,
    private loggerService: LoggerService,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      email: ['', Validators.required],
      password: ['', Validators.required],
      password2: ['', Validators.required]
    });
  }

  onSubmit(): void {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    const { email, password, password2 } = this.form.value;
    this.isLoading = true;

    if (password !== password2) {
      this.isLoading = false;
      this.snackbar.success('Passwords do not match. Please try again.');
      return;
    }

    this.userService.getAllByValue('email', email).then((users) => {
      if (users.length === 0) {
        this.loggerService.logMessage('Create Admin Account', email, 'Tried to setup Admin account for (' + email + '). This email is not recognized. Setup Admin Account first.', []);
        this.snackbar.error('No account exists for this email.');
        this.router.navigate(['/']);
        this.isLoading = false;
      } else if (users.length === 1) {
        if (users[0].firebaseUID) {
          this.snackbar.error('An account for ' + email + ' had already been setup!. Try logging in with this email address!');
          this.router.navigate(['capture-username-form']);
          this.isLoading = false;
        } else {
          this.authService.createAccount(email, password).then((result) => {
            if (result.isOk) {
              this.snackbar.success('Your account has been created. Please login using your new credentials.');
              this.router.navigate(['capture-username-form']);
            } else {
              if (result.message?.message === 'Firebase: Error (auth/email-already-in-use).') {
                this.snackbar.error('A login account for this email already exists. Please have an Admin copy the firebaseUID over to your Customer Account.');
                this.loggerService.logMessage('Create Admin Account', email, 'Error setting up Admin for (' + email + '). Firebase: Error (auth/email-already-in-use).', []);
              } else {
                this.snackbar.error('There was an error creating your account: ' + result.message);
                this.loggerService.logMessage('Create Admin Account', email, 'Error setting up Admin for (' + email + '). ' + result.message, []);
              }
            }
            this.isLoading = false;
          }).catch((err) => {
            console.log(err);
            this.isLoading = false;
          });
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
