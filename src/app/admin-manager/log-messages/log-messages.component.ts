import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { LogMessage } from 'src/app/common/models/utils/log-message.model';
import { LoggerService } from 'src/app/common/services/data/logger.service';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

// Read-only, matching the original - no add/edit/delete existed for logs,
// just a filterable list.
@Component({
    selector: 'app-log-messages',
    templateUrl: './log-messages.component.html',
    styleUrls: ['./log-messages.component.css'],
    standalone: false
})
export class LogMessagesComponent implements OnInit {
  logs$: Observable<LogMessage[]>;
  currentRows: LogMessage[] = [];
  columns: ColumnDef[] = [
    { key: 'date', label: 'Date', visible: true },
    { key: 'type', label: 'Type', visible: true },
    { key: 'error_code', label: 'Error Code', visible: true },
    { key: 'message', label: 'Message', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Logs';

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(private service: LoggerService) {}

  ngOnInit(): void {
    this.logs$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        const filtered = items
          .filter((item) =>
            Object.keys(filters).every((field) => {
              const type = field === 'date' ? 'date' : 'text';
              return matchesColumnFilter(item[field as keyof LogMessage], filters[field], type);
            })
          )
          .sort((a, b) => {
            const aTime = a.date instanceof Date ? a.date.getTime() : 0;
            const bTime = b.date instanceof Date ? b.date.getTime() : 0;
            return bTime - aTime;
          });
        this.currentRows = filtered;
        return filtered;
      }),
      tap(() => this.loading$.next(false))
    );
  }

  get displayedColumns(): string[] {
    return this.columns.filter((c) => c.visible).map((c) => c.key);
  }

  get filterColumns(): string[] {
    return this.columns.filter((c) => c.visible).map((c) => `${c.key}-filter`);
  }

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<LogMessage>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => (item as any)[c.key] ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'log_messages.xlsx');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }
}
