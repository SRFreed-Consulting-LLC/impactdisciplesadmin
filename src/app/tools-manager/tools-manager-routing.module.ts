import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ToolsManagerComponent } from './tools-manager.component';

const routes: Routes = [
  { path: '', component: ToolsManagerComponent },
  // Full-screen Mailchimp-style email builder - its own lazy chunk, reached
  // from System Templates (New Email Design / editing a builder template).
  // No NavLeaf of its own; rides tools-manager.system-templates grants.
  {
    path: 'email-designer',
    loadChildren: () => import('./email-designer/email-designer.module').then((m) => m.EmailDesignerModule)
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ToolsManagerRoutingModule { }
