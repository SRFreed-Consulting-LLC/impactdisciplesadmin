import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './common/forms/admin/login/login.component';
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
        path: 'customers-manager',
        loadChildren: () => import('./customers-manager/customers-manager.module').then(m => m.CustomersManagerModule),
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
        path: 'tools-manager',
        loadChildren: () => import('./tools-manager/tools-manager.module').then(m => m.ToolsManagerModule),
        canActivate: [ authGuard ]
      },
      {
        path: 'campaigns-manager',
        loadChildren: () => import('./campaigns-manager/campaigns-manager.module').then(m => m.CampaignsManagerModule),
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
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
