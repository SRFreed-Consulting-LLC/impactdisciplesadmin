import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';

@Component({
    selector: 'app-store-manager',
    templateUrl: './store-manager.component.html',
    styleUrls: ['./store-manager.component.css'],
    standalone: false
})
export class StoreManagerComponent extends TabShellComponent {
  protected readonly groupId = 'store-manager';
}
