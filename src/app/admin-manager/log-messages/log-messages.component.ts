import { Component, OnInit } from '@angular/core';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import { LogMessage } from 'impactdisciplescommon/src/models/utils/log-message.model';
import { LoggerService } from 'impactdisciplescommon/src/services/data/logger.service';
import { Observable, map } from 'rxjs';

@Component({
    selector: 'app-log-messages',
    templateUrl: './log-messages.component.html',
    styleUrls: ['./log-messages.component.css'],
    standalone: false
})
export class LogMessagesComponent implements OnInit {
  datasource$: Observable<DataSource>;

  itemType = 'Logs';

  constructor(private service: LoggerService) {}

  ngOnInit() {
    this.datasource$ = this.service.streamAll().pipe(
      map(
        (items) =>
          new DataSource({
            reshapeOnPush: true,
            pushAggregationTimeout: 100,
            store: new CustomStore({
              key: 'id',
              loadMode: 'raw',
              load: function (loadOptions: any) {
                return items;
              }
            })
          })
      )
    );
  }
}
