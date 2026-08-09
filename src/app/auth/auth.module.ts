import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthCardComponent } from './auth-card/auth-card.component';
import { CaptureUsernameComponent } from './capture-username/capture-username.component';
import { CapturePasswordComponent } from './capture-password/capture-password.component';
import { CreateAccountComponent } from './create-account/create-account.component';
import { ResetPasswordComponent } from './reset-password/reset-password.component';
import { ChangePasswordComponent } from './change-password/change-password.component';

// Material replacement for the impactdisciplescommon submodule's
// ImpactAdminFormsModule (DevExtreme-based) - kept entirely within this
// admin project so the app's auth screens no longer depend on any UI
// components from the shared submodules (their business-logic services -
// AdminAuthService, AuthGuardService, AppUserService, LoggerService - are
// still reused, since those aren't DevExtreme/UI and are shared for good
// reason across every app built on this submodule).
@NgModule({
  declarations: [
    AuthCardComponent,
    CaptureUsernameComponent,
    CapturePasswordComponent,
    CreateAccountComponent,
    ResetPasswordComponent,
    ChangePasswordComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatProgressSpinnerModule
  ],
  exports: [
    CaptureUsernameComponent,
    CapturePasswordComponent,
    CreateAccountComponent,
    ResetPasswordComponent,
    ChangePasswordComponent
  ]
})
export class AuthModule { }
