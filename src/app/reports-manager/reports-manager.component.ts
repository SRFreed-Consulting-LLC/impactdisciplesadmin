import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';

@Component({
    selector: 'app-reports-manager',
    templateUrl: './reports-manager.component.html',
    styleUrls: ['./reports-manager.component.css'],
    standalone: false
})
export class ReportsManagerComponent extends TabShellComponent {
  protected readonly groupId = 'reports-manager';
}
