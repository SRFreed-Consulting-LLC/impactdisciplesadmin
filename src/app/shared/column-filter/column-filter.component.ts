import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { ColumnFilterValue, FilterOperator, FilterOperatorOption, TEXT_FILTER_OPERATORS } from './column-filter.model';

// The Material equivalent of a single dx-data-grid filter-row cell: an
// operator dropdown (Contains, Equals, Greater Than, Is Blank, etc.) plus a
// value input. Used in a table's second header row, one per filterable
// column - see the `-filter` matColumnDefs in components like
// CoursesComponent for the wiring pattern.
@Component({
    selector: 'app-column-filter',
    templateUrl: './column-filter.component.html',
    styleUrls: ['./column-filter.component.scss'],
    standalone: false
})
export class ColumnFilterComponent implements OnInit {
  @Input() operators: FilterOperatorOption[] = TEXT_FILTER_OPERATORS;
  @Input() type: 'text' | 'number' | 'date' = 'text';
  @Input() placeholder = 'Filter...';
  @Output() filterChange = new EventEmitter<ColumnFilterValue>();

  operator: FilterOperator = 'contains';
  value = '';
  // The button shows a generic funnel until the user actually picks a
  // condition from the menu - once they do, it swaps to that condition's
  // own icon/glyph so the chosen filter stays visible at a glance.
  hasChosenOperator = false;

  ngOnInit(): void {
    this.operator = this.operators[0]?.value ?? 'contains';
  }

  get needsValue(): boolean {
    return this.operator !== 'blank' && this.operator !== 'notBlank';
  }

  get currentOption(): FilterOperatorOption | undefined {
    return this.operators.find((o) => o.value === this.operator);
  }

  get currentLabel(): string {
    return this.currentOption?.label ?? '';
  }

  get inputType(): string {
    return this.type === 'date' ? 'date' : this.type === 'number' ? 'number' : 'text';
  }

  selectOperator(op: FilterOperator): void {
    this.operator = op;
    this.hasChosenOperator = true;
    this.emitChange();
  }

  onValueChange(value: string): void {
    this.value = value;
    this.emitChange();
  }

  private emitChange(): void {
    this.filterChange.emit({ operator: this.operator, value: this.value });
  }
}
