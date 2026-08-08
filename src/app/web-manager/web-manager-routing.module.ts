import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { WebManagerComponent } from './web-manager.component';

const routes: Routes = [
  { path: '', component: WebManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class WebManagerRoutingModule { }
