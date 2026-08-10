import { Component, OnDestroy, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

// Material replacement for the impactdisciplescommon submodule's
// ChangePasswordFormComponent (DevExtreme dx-form based).
//
// Ported as-is: the original's onSubmit body is entirely commented out
// upstream (it even calls a changePassword() method that doesn't exist on
// AdminAuthService), so clicking "Continue" on a validly-filled form just
// spins forever today and does nothing - preserved here rather than wired
// up, per explicit instruction to port visuals/behavior faithfully rather
// than fix functionality as part of this rebuild.
@Component({
    selector: 'app-change-password',
    templateUrl: './change-password.component.html',
    styleUrls: ['../auth-form.scss', './change-password.component.scss'],
    standalone: false
})
export class ChangePasswordComponent implements OnInit, OnDestroy {
  form: FormGroup;
  isLoading = false;
  recoveryCode = '';

  private ngUnsubscribe = new Subject<void>();

  constructor(private fb: FormBuilder, private route: ActivatedRoute) {
    this.form = this.fb.group({
      password: ['', Validators.required],
      confirmedPassword: ['', [Validators.required, this.passwordsMatch.bind(this)]]
    });
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.ngUnsubscribe)).subscribe((params) => {
      this.recoveryCode = params.get('recoveryCode') || '';
    });
  }

  private passwordsMatch(control: AbstractControl): ValidationErrors | null {
    if (!this.form) {
      return null;
    }

    return control.value === this.form.get('password')?.value ? null : { mismatch: true };
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
