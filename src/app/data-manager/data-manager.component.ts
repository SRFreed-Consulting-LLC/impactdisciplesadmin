import { Component } from '@angular/core';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';

/**
 * DATA - the records the public site is built out of (2026-08-30, owner's
 * call).
 *
 * Five screens that were scattered across four managers, gathered by what
 * they ARE rather than by which module happened to own them - the same
 * principle the 2026-08 nav reorg was built on:
 *
 *   Testimonials      was Page Manager
 *   Team Page         was Page Manager
 *   Form Submissions  was Contacts Manager
 *   Products          was Store Manager
 *   Form Builder      was Tools Manager
 *
 * They have one thing in common: each is a LIST OF RECORDS that the public
 * site renders, as opposed to a page's own words (Page Manager), the site's
 * frame (Navigation, Footer), or a back-office process (orders, campaigns).
 *
 * MOVING THEM CHANGED THEIR PERMISSION SCREENKEYS - `store-manager.products`
 * became `data.products`, and so on for all five. Stored grants were
 * migrated by scripts/migrate-screenkey-renames-3.js; see MIGRATION.md for
 * the production step, which has NOT been run.
 */
@Component({
    selector: 'app-data-manager',
    templateUrl: './data-manager.component.html',
    styleUrls: ['./data-manager.component.css'],
    standalone: false
})
export class DataManagerComponent extends TabShellComponent {
  protected readonly groupId = 'data';
}
