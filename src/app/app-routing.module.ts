import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CapturePasswordFormComponent } from 'impactdisciplescommon/src/forms/admin/capture-password-form/capture-password-form.component';
import { CaptureUsernameFormComponent } from 'impactdisciplescommon/src/forms/admin/capture-username-form/capture-username-form.component';
import { ChangePasswordFormComponent } from 'impactdisciplescommon/src/forms/admin/change-password-form/change-password-form.component';
import { CreateAuthFormComponent } from 'impactdisciplescommon/src/forms/admin/create-auth-form/create-auth-form.component';
import { ResetPasswordFormComponent } from 'impactdisciplescommon/src/forms/admin/reset-password-form/reset-password-form.component';
import { MainScreenComponent } from './core/main-screen/main-screen.component';
import { WebManagerComponent } from './web-manager/web-manager.component';
import { SubscriptionsManagerComponent } from './subscriptions-manager/subscriptions-manager.component';
import { RequestsManagerComponent } from './requests-manager/requests-manager.component';
import { AdminManagerComponent } from './admin-manager/admin-manager.component';
import { EventsManagerComponent } from './events-manager/events-manager.component';
import { DashboardComponent } from './core/dashboard/dashboard.component';
import { StoreManagerComponent } from './store-manager/store-manager.component';
import { PageManagerComponent } from './page-manager/page-manager.component';
import { AuthGuardService } from 'impactdisciplescommon/src/services/utils/auth.service';

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
        component: AdminManagerComponent,
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'events-manager',
        component: EventsManagerComponent,
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'requests-manager',
        component: RequestsManagerComponent,
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'subscriptions-manager',
        component: SubscriptionsManagerComponent,
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'web-manager',
        component: WebManagerComponent,
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'page-manager',
        component: PageManagerComponent,
        canActivate: [ AuthGuardService ]
      },
      {
        path: 'store-manager',
        component: StoreManagerComponent,
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
