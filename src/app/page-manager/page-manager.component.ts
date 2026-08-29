import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';

@Component({
    selector: 'app-page-manager',
    templateUrl: './page-manager.component.html',
    styleUrls: ['./page-manager.component.css'],
    standalone: false
})
export class PageManagerComponent extends TabShellComponent {
  protected readonly groupId = 'page-manager';
}
