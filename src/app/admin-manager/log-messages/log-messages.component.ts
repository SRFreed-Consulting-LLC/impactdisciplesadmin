import { Component, OnInit } from '@angular/core';
import { LogMessage } from 'src/app/common/models/utils/log-message.model';
import { LoggerService } from 'src/app/common/services/data/logger.service';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';

// Read-only, matching the original - no add/edit/delete existed for logs,
// just a filterable list.
//
// Paginated instead of streamAll() - this table can grow large fast (every
// error anywhere in the app writes here) and nobody needs the whole history
// live in the browser just to look at recent entries. See
// PagedCollectionSource for the accumulator/infinite-scroll mechanics -
// wired directly into app-data-grid's [pagedSource] input, which drives its
// own infinite-scroll region and app-paged-table-footer. The filter row
// only ever searches rows already loaded, same trade-off as Products/
// Customers.
@Component({
    selector: 'app-log-messages',
    templateUrl: './log-messages.component.html',
    styleUrls: ['./log-messages.component.css'],
    standalone: false
})
export class LogMessagesComponent implements OnInit {
  columns: DataGridColumn<LogMessage>[] = [
    { key: 'date', label: 'Date', type: 'date', dateFormat: 'short' },
    { key: 'type', label: 'Type' },
    { key: 'error_code', label: 'Error Code' },
    { key: 'message', label: 'Message' }
  ];

  itemType = 'Logs';

  paged: PagedCollectionSource<LogMessage>;

  constructor(private service: LoggerService) {
    this.paged = new PagedCollectionSource<LogMessage>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'date', 'desc'),
      50
    );
  }

  ngOnInit(): void {
    // Each page already comes back ordered by date desc from Firestore, and
    // pages are appended in fetch order - no client-side re-sort needed, so
    // this table doesn't set [initialSortKey].
    this.paged.loadFirstPage();
  }
}
