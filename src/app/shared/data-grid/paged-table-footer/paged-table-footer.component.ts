import { Component, Input } from '@angular/core';

// Small inline status row for a paginated (PagedCollectionSource-backed)
// table - sits below the table itself, inside the same .table-scroll
// container so it scrolls into view along with the last loaded rows. Not a
// full-table overlay like app-table-loading-overlay (that's reserved for
// the very first page - this is for every page after that, where the
// already-loaded rows should stay visible and interactive while more load).
//
// No total row count is shown - Firestore doesn't return a collection's
// total size for free (a separate count() aggregate query would be its own
// extra read on every page load, just to render a "1,204 total" label), so
// this only ever reports what's actually been loaded into the browser.
@Component({
    selector: 'app-paged-table-footer',
    templateUrl: './paged-table-footer.component.html',
    styleUrls: ['./paged-table-footer.component.scss'],
    standalone: false
})
export class PagedTableFooterComponent {
  @Input() loadedCount = 0;
  @Input() loadingMore = false;
  @Input() hasMore = true;
}
