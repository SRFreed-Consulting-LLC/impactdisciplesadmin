import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RequestsManagerComponent } from './requests-manager.component';

const routes: Routes = [
  { path: '', component: RequestsManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class RequestsManagerRoutingModule { }
