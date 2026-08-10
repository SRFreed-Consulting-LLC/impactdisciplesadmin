import { Component, Input } from '@angular/core';

// A house rule: every data table shows a loading spinner while its data is
// being fetched, and it disappears the moment real data (even an empty
// array) has actually arrived - never a fixed delay, never left showing
// indefinitely if a stream never emits. Meant to sit as the first child of
// the same element that scrolls the table (e.g. .table-scroll), which
// needs position: relative for this to overlay it correctly.
@Component({
    selector: 'app-table-loading-overlay',
    templateUrl: './table-loading-overlay.component.html',
    styleUrls: ['./table-loading-overlay.component.scss'],
    standalone: false
})
export class TableLoadingOverlayComponent {
  @Input() loading: boolean | null = false;
}
