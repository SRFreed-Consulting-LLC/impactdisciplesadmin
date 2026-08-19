import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ContentManagerComponent } from './content-manager.component';

const routes: Routes = [
  { path: '', component: ContentManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ContentManagerRoutingModule { }
