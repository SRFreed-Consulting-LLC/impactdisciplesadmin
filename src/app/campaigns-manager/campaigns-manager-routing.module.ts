import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CampaignsManagerComponent } from './campaigns-manager.component';

const routes: Routes = [
  { path: '', component: CampaignsManagerComponent },
  // Full-screen campaign email editor - design and schedule on one screen,
  // its own lazy chunk because it pulls in the whole email builder. Reached
  // from a campaign's detail timeline (New Email / editing a draft), no
  // NavLeaf of its own; rides campaigns-manager.campaigns grants. Declared
  // AFTER the '' route so the tab shell still owns /campaigns-manager.
  {
    path: 'email',
    loadChildren: () => import('./campaign-email-editor/campaign-email-editor.module')
      .then((m) => m.CampaignEmailEditorModule)
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CampaignsManagerRoutingModule { }
