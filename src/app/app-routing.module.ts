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
        path: 'contacts-manager',
        loadChildren: () => import('./contacts-manager/contacts-manager.module').then(m => m.ContactsManagerModule),
        canActivate: [ authGuard ]
      },
      {
        path: 'page-manager',
        loadChildren: () => import('./page-manager/page-manager.module').then(m => m.PageManagerModule),
        canActivate: [ authGuard ]
      },
      // The public site's top menu. A screen of its own rather than a Page
      // Manager tab (2026-08-30): the menu is the site's frame, not any one
      // page's content. Its files live under page-manager/ anyway - see
      // NavigationModule's own comment on why.
      // The records the public site is built out of - Products,
      // Testimonials, Team Page, Form Submissions, Form Builder - gathered
      // from four managers on 2026-08-30. See data-manager.component.ts.
      {
        path: 'data',
        loadChildren: () => import('./data-manager/data-manager.module').then(m => m.DataManagerModule),
        canActivate: [ authGuard ]
      },
      {
        path: 'navigation',
        loadChildren: () => import('./page-manager/navigation/navigation.module').then(m => m.NavigationModule),
        canActivate: [ authGuard ]
      },
      // 2026-08-19 renames (Customers Manager -> Contacts Manager, Web
      // Manager -> Content Manager) and 2026-08-29 (Content Manager -> Page
      // Manager): old paths redirect so pre-rename bookmarks and stale deep
      // links keep working. redirectTo preserves query params (?tab=,
      // ?purchaseId=) by default.
      //
      // web-manager points straight at page-manager rather than hopping
      // through content-manager - a redirect chain re-runs route matching
      // and would work, but one hop is one thing to reason about.
      { path: 'customers-manager', redirectTo: 'contacts-manager' },
      { path: 'web-manager', redirectTo: 'page-manager' },
      { path: 'content-manager', redirectTo: 'page-manager' },
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
      },
      {
        path: 'library-manager',
        loadChildren: () => import('./library-manager/library-manager.module').then(m => m.LibraryManagerModule),
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
