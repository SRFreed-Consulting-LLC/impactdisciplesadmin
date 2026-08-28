import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';

@Component({
    selector: 'app-library-manager',
    templateUrl: './library-manager.component.html',
    styleUrls: ['./library-manager.component.css'],
    standalone: false
})
export class LibraryManagerComponent extends TabShellComponent {
  protected readonly groupId = 'library-manager';
}
