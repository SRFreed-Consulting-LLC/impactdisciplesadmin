import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
// What the DOCKING BAR needs, which arrived with it on 2026-09-01:
// a reactive form, a spinner, a select, and the shared list header.
import { ReactiveFormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { SharedModule } from '../../shared/shared.module';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PageLivePreviewModule } from '../pages/page-live-preview.module';
import { SiteFooterAdminComponent } from './footer.component';
import { FooterManagerComponent } from './footer-manager.component';
// Its FILES stay under page-manager/web-config - the same arrangement
// NavigationModule and the Data module already have. Moving them would
// make the diff unreadable and buys nothing.
import { DockingBarComponent } from '../docking-bar/docking-bar.component';
import { footerCanDeactivateGuard } from '../navigation/site-frame.guard';

/**
 * FOOTER - a top-level screen alongside Navigation, for the same reason: the
 * footer is the site's frame rather than any one page's content, and it
 * renders on every page.
 *
 * Same permission consequence as Navigation, and it is worth repeating: a
 * NavGroup with no `items` sits outside the granular permission system
 * (buildPermissionTree skips them), so this screen is Admin/Root only and
 * cannot be granted to an Employee.
 */
// The SHELL is what /footer opens now (2026-09-01) - it switches between
// the footer editor and the docking bar on ?tab=, the same way every other
// group in the nav does.
//
// The unsaved-changes guard stays on this route rather than moving onto the
// footer editor: the guard fires on leaving the ROUTE, and switching tabs
// inside the shell is a query-param navigation that never leaves it. Moving
// it would mean an admin could tab away from unsaved footer edits and lose
// them silently.
const routes: Routes = [
  { path: '', component: FooterManagerComponent, canDeactivate: [footerCanDeactivateGuard] }
];

@NgModule({
  declarations: [
    SiteFooterAdminComponent,
    FooterManagerComponent,
    DockingBarComponent
  ],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    PageLivePreviewModule,
    FormsModule,
    ReactiveFormsModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    SharedModule,
    DragDropModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatTooltipModule
  ]
})
export class SiteFooterModule { }
