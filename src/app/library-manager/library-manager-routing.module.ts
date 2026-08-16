import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LibraryManagerComponent } from './library-manager.component';

const routes: Routes = [
  { path: '', component: LibraryManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LibraryManagerRoutingModule { }
