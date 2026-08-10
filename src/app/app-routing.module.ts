import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './common/forms/admin/login/login.component';
import { ChangePasswordComponent } from './core/auth/change-password/change-password.component';
import { ResetPasswordComponent } from './core/auth/reset-password/reset-password.component';
import { MainScreenComponent } from './core/main-screen/main-screen.component';
import { DashboardComponent } from './core/dashboard/dashboard.component';
import { ThemesComponent } from './core/settings/themes.component';
import { authGuard } from 'src/app/common/forms/admin/admin-auth.service';

const routes: Routes = [
  {
    path: '',
    component: MainScreenComponent,
    canActivate: [ authGuard ],
    children: [
      {
        path: '',
        component: DashboardComponent,
        canActivate: [ authGuard ]
      },
      {
        path: 'home',
        component: DashboardComponent,
        canActivate: [ authGuard ]
      },
      {
        path: 'settings',
        component: ThemesComponent,
        canActivate: [ authGuard ]
      },
      {
        path: 'admin-manager',
        loadChildren: () => import('./admin-manager/admin-manager.module').then(m => m.AdminManagerModule),
        canActivate: [ authGuard ]
      },
      {
        path: 'events-manager',
        loadChildren: () => import('./events-manager/events-manager.module').then(m => m.EventsManagerModule),
        canActivate: [ authGuard ]
      },
      {
        path: 'requests-manager',
        loadChildren: () => import('./requests-manager/requests-manager.module').then(m => m.RequestsManagerModule),
        canActivate: [ authGuard ]
      },
      {
        path: 'subscriptions-manager',
        loadChildren: () => import('./subscriptions-manager/subscriptions-manager.module').then(m => m.SubscriptionsManagerModule),
        canActivate: [ authGuard ]
      },
      {
        path: 'web-manager',
        loadChildren: () => import('./web-manager/web-manager.module').then(m => m.WebManagerModule),
        canActivate: [ authGuard ]
      },
      {
        path: 'store-manager',
        loadChildren: () => import('./store-manager/store-manager.module').then(m => m.StoreManagerModule),
        canActivate: [ authGuard ]
      },
      {
        path: 'reports-manager',
        loadChildren: () => import('./reports-manager/reports-manager.module').then(m => m.ReportsManagerModule),
        canActivate: [ authGuard ]
      }
    ]
  },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [ authGuard ]
  },
  {
    path: 'reset-password',
    component: ResetPasswordComponent,
    canActivate: [ authGuard ]
  },
  {
    path: 'change-password/:recoveryCode',
    component: ChangePasswordComponent,
    canActivate: [ authGuard ]
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
