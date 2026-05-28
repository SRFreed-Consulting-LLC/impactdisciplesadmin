import { Component, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { confirm } from 'devextreme/ui/dialog';
import { HomePagePopupModel } from 'impactdisciplescommon/src/models/domain/home-page-popup.model';
import { Observable, BehaviorSubject, map } from 'rxjs';
import { HomePagePopUpService } from 'impactdisciplescommon/src/services/data/home-page-popup.service';
import CustomStore from 'devextreme/data/custom_store';

@Component({
  selector: 'app-home-page-popups',
  templateUrl: './home-page-popups.component.html',
  styleUrls: ['./home-page-popups.component.css']
})
export class HomePagePopupsComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  datasource$: Observable<DataSource>;
  selectedItem: HomePagePopupModel;

  itemType = 'Home Page Popup'

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);
  public isPreviewVisible$ = new BehaviorSubject<boolean>(false);
  public isSingleImageVisible$ = new BehaviorSubject<boolean>(false);

  constructor(private service: HomePagePopUpService) {}

  async ngOnInit(): Promise<void> {
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

  showAddModal = () => {
    this.selectedItem = {... new HomePagePopupModel()};
    this.selectedItem.text = '<div style="margin: 0px; padding: 0px; height: 100%; width:100%;"></div>'
    this.isVisible$.next(true);
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));
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

  onSave(item: HomePagePopupModel) {
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

  showPreview = (e) => {
    this.isPreviewVisible$.next(true);
  }

  onCancelPreview() {
    this.inProgress$.next(false);
    this.isPreviewVisible$.next(false);
  }
}
