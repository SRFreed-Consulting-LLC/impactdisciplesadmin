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
import { SiteFooterAdminComponent } from './footer.component';
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
const routes: Routes = [
  { path: '', component: SiteFooterAdminComponent, canDeactivate: [footerCanDeactivateGuard] }
];

@NgModule({
  declarations: [SiteFooterAdminComponent],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
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
export class SiteFooterModule { }
