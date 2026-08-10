import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { AuthCardComponent } from './auth-card/auth-card.component';
import { LoginComponent } from '../../common/forms/admin/login/login.component';
import { AnimatedLogoComponent } from '../../common/forms/admin/login/animated-logo.component';
import { ResetPasswordComponent } from './reset-password/reset-password.component';
import { ChangePasswordComponent } from './change-password/change-password.component';

// Material replacement for the impactdisciplescommon submodule's
// ImpactAdminFormsModule (DevExtreme-based) - kept entirely within this
// admin project so the app's auth screens no longer depend on any UI
// components from the shared submodules (their business-logic services -
// AdminAuthService, AuthGuardService, AdminUserService, LoggerService - are
// still reused, since those aren't DevExtreme/UI and are shared for good
// reason across every app built on this submodule).
//
// LoginComponent/AnimatedLogoComponent live physically under
// common/forms/admin/login/ (alongside AdminAuthService) rather than here,
// but are still declared/exported by this module like every other auth
// screen - file location and NgModule declaration are independent in
// Angular, and AdminAuthService's own location is the existing precedent
// for "common" business logic vs. "auth" screens using it.
@NgModule({
  declarations: [
    AuthCardComponent,
    LoginComponent,
    AnimatedLogoComponent,
    ResetPasswordComponent,
    ChangePasswordComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule
  ],
  exports: [
    LoginComponent,
    ResetPasswordComponent,
    ChangePasswordComponent
  ]
})
export class AuthModule { }
