import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';

@Component({
    selector: 'app-content-manager',
    templateUrl: './content-manager.component.html',
    styleUrls: ['./content-manager.component.css'],
    standalone: false
})
export class ContentManagerComponent extends TabShellComponent {
  protected readonly groupId = 'content-manager';
}
