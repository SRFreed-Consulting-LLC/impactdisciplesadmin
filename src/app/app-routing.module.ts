import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CapturePasswordComponent } from './auth/capture-password/capture-password.component';
import { CaptureUsernameComponent } from './auth/capture-username/capture-username.component';
import { ChangePasswordComponent } from './auth/change-password/change-password.component';
import { CreateAccountComponent } from './auth/create-account/create-account.component';
import { ResetPasswordComponent } from './auth/reset-password/reset-password.component';
import { MainScreenComponent } from './core/main-screen/main-screen.component';
import { DashboardComponent } from './core/dashboard/dashboard.component';
import { AuthGuardService } from 'src/app/common/forms/admin/admin-auth.service';

const routes: Routes = [
  {
    path: '',
    component: MainScreenComponent,
    canActivate: [ AuthGuardService ],
    children: [
      {
        path: '',
        component: DashboardComponent,
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'home',
        component: DashboardComponent,
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'admin-manager',
        loadChildren: () => import('./admin-manager/admin-manager.module').then(m => m.AdminManagerModule),
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'events-manager',
        loadChildren: () => import('./events-manager/events-manager.module').then(m => m.EventsManagerModule),
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'requests-manager',
        loadChildren: () => import('./requests-manager/requests-manager.module').then(m => m.RequestsManagerModule),
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'subscriptions-manager',
        loadChildren: () => import('./subscriptions-manager/subscriptions-manager.module').then(m => m.SubscriptionsManagerModule),
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'web-manager',
        loadChildren: () => import('./web-manager/web-manager.module').then(m => m.WebManagerModule),
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'store-manager',
        loadChildren: () => import('./store-manager/store-manager.module').then(m => m.StoreManagerModule),
        canActivate: [ AuthGuardService ]
      }
    ]
  },
  {
    path: 'capture-username-form',
    component: CaptureUsernameComponent,
    canActivate: [ AuthGuardService ]
  },
  {
    path: 'capture-password-form',
    component: CapturePasswordComponent,
    canActivate: [ AuthGuardService ]
  },
  {
    path: 'create-auth-form',
    component: CreateAccountComponent,
    canActivate: [ AuthGuardService ]
  },
  {
    path: 'reset-password',
    component: ResetPasswordComponent,
    canActivate: [ AuthGuardService ]
  },
  {
    path: 'change-password/:recoveryCode',
    component: ChangePasswordComponent,
    canActivate: [ AuthGuardService ]
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
