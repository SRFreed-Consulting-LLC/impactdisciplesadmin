import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
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
import { NavigationComponent } from './navigation.component';
import { navigationCanDeactivateGuard } from './site-frame.guard';

/**
 * NAVIGATION - a TOP-LEVEL screen, not a Page Manager tab (Shane's call,
 * 2026-08-30).
 *
 * The reasoning it now carries in the nav: the menu is the site's FRAME
 * rather than any one page's content. It is on every page, and it is the
 * only thing on the Site tab that is not a page.
 *
 * THE FILES STAY UNDER page-manager/, which reads oddly for a top-level
 * route and is deliberate: navigation.component.ts borrows
 * ../pages/page-stack.component.css outright so that this screen IS a
 * section stack rather than a lookalike. Moving the folder would turn that
 * into a long relative path pointing back into a feature area it no longer
 * belongs to, for no gain.
 *
 * ONE CONSEQUENCE WORTH KNOWING. A NavGroup with no `items` is outside the
 * granular permission system - PermissionService.buildPermissionTree() skips
 * groups that have none, exactly as it does for Home. So this screen is
 * Admin/Root only and CANNOT be granted to an Employee, where it could be
 * while it was a Page Manager leaf. If an Employee ever needs the menu, it
 * has to go back to being a leaf, or grow a leaf of its own.
 */
const routes: Routes = [
  { path: '', component: NavigationComponent, canDeactivate: [navigationCanDeactivateGuard] }
];

@NgModule({
  declarations: [NavigationComponent],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    PageLivePreviewModule,
    FormsModule,
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
export class NavigationModule { }
