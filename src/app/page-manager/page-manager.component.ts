import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';
import { EDITABLE_PAGES, EditablePage } from './pages/editable-pages';

@Component({
    selector: 'app-page-manager',
    templateUrl: './page-manager.component.html',
    styleUrls: ['./page-manager.component.css'],
    standalone: false
})
export class PageManagerComponent extends TabShellComponent {
  protected readonly groupId = 'page-manager';

  /**
   * The pages served by the generic editor. Their nav leaves live in
   * nav-config.ts like every other screen; this is what maps the selected
   * tab onto the right catalogue entry.
   */
  readonly editablePages: readonly EditablePage[] = EDITABLE_PAGES;
}
