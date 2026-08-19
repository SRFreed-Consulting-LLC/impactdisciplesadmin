import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ContactsManagerComponent } from './contacts-manager.component';

const routes: Routes = [
  { path: '', component: ContactsManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ContactsManagerRoutingModule { }
