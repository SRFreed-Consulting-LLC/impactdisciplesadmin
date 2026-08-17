import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { EmailDesignerComponent } from './email-designer.component';
import { emailDesignerCanDeactivateGuard } from './email-designer.guard';

// /tools-manager/email-designer/new  - start a fresh design
// /tools-manager/email-designer/:id  - edit an existing builder template
// Both are full-screen (no tab shell) and ride the
// tools-manager.email-templates permission grants - see
// EmailDesignerComponent's ngOnInit and nav-config.ts.
const routes: Routes = [
  { path: 'new', component: EmailDesignerComponent, canDeactivate: [emailDesignerCanDeactivateGuard] },
  { path: ':id', component: EmailDesignerComponent, canDeactivate: [emailDesignerCanDeactivateGuard] },
  { path: '', redirectTo: 'new', pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class EmailDesignerRoutingModule {}
