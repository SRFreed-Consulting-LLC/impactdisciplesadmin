import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';

@Component({
    selector: 'app-contacts-manager',
    templateUrl: './contacts-manager.component.html',
    styleUrls: ['./contacts-manager.component.css'],
    standalone: false
})
export class ContactsManagerComponent extends TabShellComponent {
  protected readonly groupId = 'contacts-manager';
}
