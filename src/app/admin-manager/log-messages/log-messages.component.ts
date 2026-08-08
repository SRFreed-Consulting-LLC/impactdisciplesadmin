import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { LogMessage } from 'impactdisciplescommon/src/models/utils/log-message.model';
import { LoggerService } from 'impactdisciplescommon/src/services/data/logger.service';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

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
  displayedColumns = ['date', 'type', 'error_code', 'message'];
  filterColumns = ['date-filter', 'type-filter', 'error_code-filter', 'message-filter'];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Logs';

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(private service: LoggerService) {}

  ngOnInit(): void {
    this.logs$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
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
          })
      )
    );
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }
}
