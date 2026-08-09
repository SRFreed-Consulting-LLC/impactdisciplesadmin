import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CapturePasswordFormComponent } from 'impactdisciplescommon/src/forms/admin/capture-password-form/capture-password-form.component';
import { CaptureUsernameFormComponent } from 'impactdisciplescommon/src/forms/admin/capture-username-form/capture-username-form.component';
import { ChangePasswordFormComponent } from 'impactdisciplescommon/src/forms/admin/change-password-form/change-password-form.component';
import { CreateAuthFormComponent } from 'impactdisciplescommon/src/forms/admin/create-auth-form/create-auth-form.component';
import { ResetPasswordFormComponent } from 'impactdisciplescommon/src/forms/admin/reset-password-form/reset-password-form.component';
import { MainScreenComponent } from './core/main-screen/main-screen.component';
import { DashboardComponent } from './core/dashboard/dashboard.component';
import { AuthGuardService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';

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
    component: CaptureUsernameFormComponent,
    canActivate: [ AuthGuardService ]
  },
  {
    path: 'capture-password-form',
    component: CapturePasswordFormComponent,
    canActivate: [ AuthGuardService ]
  },
  {
    path: 'create-auth-form',
    component: CreateAuthFormComponent,
    canActivate: [ AuthGuardService ]
  },
  {
    path: 'reset-password',
    component: ResetPasswordFormComponent,
    canActivate: [ AuthGuardService ]
  },
  {
    path: 'change-password/:recoveryCode',
    component: ChangePasswordFormComponent,
    canActivate: [ AuthGuardService ]
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
