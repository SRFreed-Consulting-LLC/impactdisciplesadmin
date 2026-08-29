import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';
import { EDITABLE_PAGES, EditablePage } from './pages/page-section-catalogue';

@Component({
    selector: 'app-page-manager',
    templateUrl: './page-manager.component.html',
    styleUrls: ['./page-manager.component.css'],
    standalone: false
})
export class PageManagerComponent extends TabShellComponent {
  protected readonly groupId = 'page-manager';

  /**
   * Every public page, each an ordered stack of sections on one screen.
   *
   * Their nav leaves live in nav-config.ts like every other screen; this is
   * what maps the selected tab onto the right catalogue entry. About Us used
   * to have its own block here, because it was the only page whose template
   * was a dispatcher - all eleven are now, so it does not.
   */
  readonly editablePages: readonly EditablePage[] = EDITABLE_PAGES;
}
