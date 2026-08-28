import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';

@Component({
    selector: 'app-campaigns-manager',
    templateUrl: './campaigns-manager.component.html',
    styleUrls: ['./campaigns-manager.component.css'],
    standalone: false
})
export class CampaignsManagerComponent extends TabShellComponent {
  protected readonly groupId = 'campaigns-manager';
}
