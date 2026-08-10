import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ReportsManagerComponent } from './reports-manager.component';

const routes: Routes = [
  { path: '', component: ReportsManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ReportsManagerRoutingModule { }
