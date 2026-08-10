import { Directive, Input, TemplateRef } from '@angular/core';

// Lets a caller override how one column's cells render, without the grid
// needing to know anything about that column's actual content:
//
//   <ng-template appDataGridCell="isActive" let-row>
//     <span class="active-template" [style.background-color]="row.isActive ? '#29d029' : 'red'">
//       {{ row.isActive ? 'LIVE' : 'INACTIVE' }}
//     </span>
//   </ng-template>
//
// <app-data-grid> collects every projected template keyed by its
// [appDataGridCell] column key (see DataGridComponent.rebuildCellTemplateMap)
// and renders it instead of the plain-text default for that column only -
// every other column still falls through to `{{ resolveValue(column, row) }}`.
@Directive({
    selector: '[appDataGridCell]',
    standalone: false
})
export class DataGridCellDirective<T = unknown> {
  @Input('appDataGridCell') columnKey = '';

  constructor(public templateRef: TemplateRef<{ $implicit: T }>) {}
}
