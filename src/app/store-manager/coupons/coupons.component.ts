import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { CouponModel } from 'impactdisciplescommon/src/models/utils/coupon.model';
import { CouponService } from 'impactdisciplescommon/src/services/data/coupon.service';
import { BehaviorSubject, Observable, Subject, map, merge, takeUntil } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { TagModel } from 'impactdisciplescommon/src/models/domain/tag.model';
import { ProductService } from 'impactdisciplescommon/src/services/data/product.service';
import { EventService } from 'impactdisciplescommon/src/services/data/event.service';

@Component({
    selector: 'app-coupons',
    templateUrl: './coupons.component.html',
    styleUrls: ['./coupons.component.css'],
    standalone: false
})
export class CouponsComponent implements OnInit, OnDestroy {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  datasource$: Observable<DataSource>;
  selectedItem: CouponModel;

  itemType = 'Coupon';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);

  couponTags: TagModel[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(private service: CouponService,
    private eventService: EventService,
    private productService: ProductService) {}

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

    let list = merge(
      this.eventService.streamAll(),
      this.productService.streamAll()
    )

    list.pipe(takeUntil(this.ngUnsubscribe)).subscribe(items => {
      items.forEach(item => this.couponTags.push({id: item.id, tag: item.title? item.title : item.eventName}));
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new CouponModel()};

    this.isVisible$.next(true);
  }

  delete = ({ row: { data } }) => {
    confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        this.service.delete(data.id).then(() => {
          notify({
            message: this.itemType + ' Deleted',
            position: 'top',
            width: 600,
            type: 'success'
          });
        })
      }
    });
  }

  onSave(item: CouponModel) {
    if(this.addEditForm.instance.validate().isValid) {
      this.inProgress$.next(true);

      if(item.id) {
        this.service.update(item.id, item).then((item) => {
          if(item) {
            notify({
              message: this.itemType + ' Updated',
              position: 'top',
              width: 600,
              type: 'success'
            });
            this.onCancel();
          } else {
            this.inProgress$.next(false);
            notify({
              message: 'Some Error Occured',
              position: 'top',
              width: 600,
              type: 'success'
            });
          }
        })
      } else {
        this.service.add(item).then((item) => {
          if(item) {
            notify({
              message: this.itemType + ' Added',
              position: 'top',
              width: 600,
              type: 'success'
            });
            this.onCancel();
          } else {
            this.inProgress$.next(false);
            notify({
              message: 'Some Error Occured',
              position: 'top',
              width: 600,
              type: 'error'
            });
          }
        })
      }
    }
  }

  onCancel() {
    this.selectedItem = null;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  formatDate(time: number){
    return (dateFromTimestamp(time) as Date).toDateString();
  }

  validateCouponValue(e){
    if(!e.data.percentOff && !e.data.dollarsOff){
      return false;
    }

    return true;
  }
}
