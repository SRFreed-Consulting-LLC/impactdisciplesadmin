import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ToolsManagerComponent } from './tools-manager.component';

const routes: Routes = [
  { path: '', component: ToolsManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ToolsManagerRoutingModule { }
