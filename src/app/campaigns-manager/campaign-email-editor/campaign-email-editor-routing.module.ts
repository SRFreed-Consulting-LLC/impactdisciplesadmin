import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CampaignEmailEditorComponent } from './campaign-email-editor.component';
import { campaignEmailEditorCanDeactivateGuard } from './campaign-email-editor.guard';

// /campaigns-manager/email/:campaignId/new  - author a new email for that campaign
// /campaigns-manager/email/:campaignId/:touchId  - edit a draft/scheduled one
// Full-screen (no tab shell), reached from a campaign's detail timeline, and
// rides the campaigns-manager.campaigns permission grants - see
// CampaignEmailEditorComponent's load().
const routes: Routes = [
  {
    path: ':campaignId/:touchId',
    component: CampaignEmailEditorComponent,
    canDeactivate: [campaignEmailEditorCanDeactivateGuard]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CampaignEmailEditorRoutingModule {}
