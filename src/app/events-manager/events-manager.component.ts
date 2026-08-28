import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';

@Component({
    selector: 'app-events-manager',
    templateUrl: './events-manager.component.html',
    styleUrls: ['./events-manager.component.css'],
    standalone: false
})
export class EventsManagerComponent extends TabShellComponent {
  protected readonly groupId = 'events-manager';
}
