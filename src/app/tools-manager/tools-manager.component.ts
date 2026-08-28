import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';

@Component({
    selector: 'app-tools-manager',
    templateUrl: './tools-manager.component.html',
    styleUrls: ['./tools-manager.component.css'],
    standalone: false
})
export class ToolsManagerComponent extends TabShellComponent {
  protected readonly groupId = 'tools-manager';
}
