import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { LogMessage } from 'src/app/common/models/utils/log-message.model';
import { LoggerService } from 'src/app/common/services/data/logger.service';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { PagedCollectionSource } from '../../shared/paged-collection-source';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

// Read-only, matching the original - no add/edit/delete existed for logs,
// just a filterable list.
//
// Paginated instead of streamAll() - this table can grow large fast (every
// error anywhere in the app writes here) and nobody needs the whole history
// live in the browser just to look at recent entries. See
// PagedCollectionSource for the accumulator/infinite-scroll mechanics; the
// filter row below only ever searches rows already loaded, same trade-off
// as Products/Customers.
@Component({
    selector: 'app-log-messages',
    templateUrl: './log-messages.component.html',
    styleUrls: ['./log-messages.component.css'],
    standalone: false
})
export class LogMessagesComponent implements OnInit {
  logs$: Observable<LogMessage[]>;
  currentRows: LogMessage[] = [];
  loadedCount = 0;
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
  // customers.component.ts for the full explanation. loading$/loadingMore$/
  // hasMore$ are the paged source's own subjects, reused directly rather
  // than mirrored, so the template can bind to them as-is.
  loading$: BehaviorSubject<boolean>;
  loadingMore$: BehaviorSubject<boolean>;
  hasMore$: BehaviorSubject<boolean>;

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});
  private paged: PagedCollectionSource<LogMessage>;

  constructor(private service: LoggerService) {
    this.paged = new PagedCollectionSource<LogMessage>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'date', 'desc'),
      50
    );
    this.loading$ = this.paged.loading$;
    this.loadingMore$ = this.paged.loadingMore$;
    this.hasMore$ = this.paged.hasMore$;
  }

  ngOnInit(): void {
    // Each page already comes back ordered by date desc from Firestore, and
    // pages are appended in fetch order - no client-side re-sort needed
    // (unlike the old streamAll()-based version, which had to sort itself
    // since a live collection snapshot has no inherent order).
    this.logs$ = combineLatest([this.paged.rows$, this.filters$]).pipe(
      map(([items, filters]) => {
        const filtered = items.filter((item) =>
          Object.keys(filters).every((field) => {
            const type = field === 'date' ? 'date' : 'text';
            return matchesColumnFilter(item[field as keyof LogMessage], filters[field], type);
          })
        );
        this.currentRows = filtered;
        this.loadedCount = items.length;
        return filtered;
      })
    );

    this.paged.loadFirstPage();
  }

  loadMore(): void {
    this.paged.loadNextPage();
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
      value: (item) => ((item as unknown as Record<string, unknown>)[c.key] as string | number | Date | null | undefined) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'log_messages.xlsx');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }
}
