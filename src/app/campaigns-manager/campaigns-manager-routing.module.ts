import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CampaignsManagerComponent } from './campaigns-manager.component';

const routes: Routes = [
  { path: '', component: CampaignsManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CampaignsManagerRoutingModule { }
