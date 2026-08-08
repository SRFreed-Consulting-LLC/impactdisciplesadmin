import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SubscriptionsManagerComponent } from './subscriptions-manager.component';

const routes: Routes = [
  { path: '', component: SubscriptionsManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class SubscriptionsManagerRoutingModule { }
