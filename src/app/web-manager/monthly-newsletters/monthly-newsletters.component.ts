import { Component, OnInit } from '@angular/core';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import { MonthlyNewsletterModel } from 'impactdisciplescommon/src/models/domain/monthly-newsletter.model';
import { MonthlyNewletterService } from 'impactdisciplescommon/src/services/data/monthly-newsletter.service';
import { map, Observable } from 'rxjs';

@Component({
    selector: 'app-monthly-newsletters',
    templateUrl: './monthly-newsletters.component.html',
    styleUrls: ['./monthly-newsletters.component.css'],
    standalone: false
})
export class MonthlyNewslettersComponent implements OnInit {
  datasource$: Observable<DataSource>;
  selectedItem: MonthlyNewsletterModel;
  itemType = 'Monthly Newletter'

  constructor(private service: MonthlyNewletterService,) { }

  ngOnInit() {
    let that = this;

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
            },
            insert(value) {
              return that.service.add(value);
            },
            update(key, value) {
              return that.service.update(key, value);
            },
            remove(key) {
              return that.service.delete(key);
            },
          })
        })
      ))
  }
  onRowUpdating(options) {
    options.newData = Object.assign(options.oldData, options.newData);
  }
}
