import { Component, OnDestroy, OnInit } from '@angular/core';
import { Actions, ofActionDispatched, Store } from '@ngxs/store';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import { SeriesService } from 'impactdisciplescommon/src/services/data/series.service';
import { BehaviorSubject, map, Observable, Subject, takeUntil } from 'rxjs';
import { ShowProductSeriesModal } from './product-series-modal.actions';
import notify from 'devextreme/ui/notify';
import { confirm } from 'devextreme/ui/dialog';
import { ShowSeriesModal } from './series-modal/series-modal.actions';

@Component({
    selector: 'app-product-series',
    templateUrl: './product-series.component.html',
    styleUrls: ['./product-series.component.css'],
    standalone: false
})
export class ProductSeriesComponent implements OnInit, OnDestroy {
  datasource$: Observable<DataSource>;

  public isVisible$ = new BehaviorSubject<boolean>(false);

  private ngUnsubscribe = new Subject<void>();

  constructor(private service: SeriesService, private store: Store, private actions$: Actions) {}

  ngOnInit(): void {
    this.actions$.pipe(ofActionDispatched(ShowProductSeriesModal), takeUntil(this.ngUnsubscribe)).subscribe(() => {
      this.isVisible$.next(true)
    })
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

  showEditModal = (e) => {
    this.store.dispatch(new ShowSeriesModal(e.data));
  }

  showAddModal = () => {
    this.store.dispatch(new ShowSeriesModal());
  }

  delete = ({ row: { data } }) => {
    confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        this.service.delete(data.id).then(() => {
          notify({
            message: 'Series Deleted',
            position: 'top',
            width: 600,
            type: 'success'
          });
        })
      }
    });
  }

  onCancel() {
    this.isVisible$.next(false);
  }

  ngOnDestroy() {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
