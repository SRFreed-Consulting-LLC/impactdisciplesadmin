import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CustomersManagerComponent } from './customers-manager.component';

const routes: Routes = [
  { path: '', component: CustomersManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CustomersManagerRoutingModule { }
