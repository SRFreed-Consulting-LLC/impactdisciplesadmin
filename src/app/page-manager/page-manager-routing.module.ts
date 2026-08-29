import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PageManagerComponent } from './page-manager.component';

const routes: Routes = [
  { path: '', component: PageManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PageManagerRoutingModule { }
