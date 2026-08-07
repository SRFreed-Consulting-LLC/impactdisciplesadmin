import { CategoryModel } from '../../../../impactdisciplescommon/src/models/utils/categories.model';
import { Component, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { BehaviorSubject, map, Observable, Subject, takeUntil } from 'rxjs';
import notify from 'devextreme/ui/notify';
import { confirm } from 'devextreme/ui/dialog';
import { DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import { TagModel } from 'impactdisciplescommon/src/models/domain/tag.model';
import { ProductCategoriesService } from 'impactdisciplescommon/src/services/data/product-categories.service';
import { Actions, ofActionDispatched, Store } from '@ngxs/store';
import { ShowCategoryModal } from './category-modal/category-modal.actions';
import { ShowProductCategoriesModal } from './product-categories-modal.actions';

@Component({
    selector: 'app-product-categories',
    templateUrl: './product-categories.component.html',
    styleUrls: ['./product-categories.component.css'],
    standalone: false
})
export class ProductCategoriesComponent implements OnInit, OnDestroy {
  datasource$: Observable<DataSource>;

  public isVisible$ = new BehaviorSubject<boolean>(false);

  private ngUnsubscribe = new Subject<void>();

  constructor(private service: ProductCategoriesService, private store: Store, private actions$: Actions) {}

  ngOnInit() {
    this.actions$.pipe(ofActionDispatched(ShowProductCategoriesModal), takeUntil(this.ngUnsubscribe)).subscribe(() => {
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
    this.store.dispatch(new ShowCategoryModal(e.data));
  }

  showAddModal = () => {
    this.store.dispatch(new ShowCategoryModal());
  }

  delete = ({ row: { data } }) => {
    confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        this.service.delete(data.id).then(() => {
          notify({
            message: 'Category Deleted',
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
