import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { EventsManagerComponent } from './events-manager.component';

const routes: Routes = [
  { path: '', component: EventsManagerComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class EventsManagerRoutingModule { }
