import { Component, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import { Timestamp } from 'firebase/firestore';
import { HomePageImageService } from 'impactdisciplescommon/src/services/data/home-page-images.service';
import { HomePageImageModel } from 'impactdisciplescommon/src/models/domain/home-page-image.model';
import menuData from 'impactdisciplescommon/src/services/data/nav-menu-data';

@Component({
  selector: 'app-home-page-images',
  templateUrl: './home-page-images.component.html',
  styleUrls: ['./home-page-images.component.css']
})
export class HomePageImagesComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  datasource$: Observable<DataSource>;
  selectedItem: HomePageImageModel;

  itemType = 'Home Page Image'

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);
  public isSingleImageVisible$ = new BehaviorSubject<boolean>(false);

  sides: any[] = [{text: 'Left', value:'l'}, {text: 'Right', value:'r'}];

  destinations: any[] = [];

  constructor(private service: HomePageImageService) {}

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

    menuData.forEach(menuData => {
      this.destinations.push({text: menuData.title, value: menuData.link})

      if(menuData.hasDropdown){
        menuData.dropdownItems.forEach(ddMenu =>{
          this.destinations.push({text: ddMenu.title, value: ddMenu.link})
        })
      }
    })
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));
    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new HomePageImageModel()};
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

  onSave(item: HomePageImageModel) {
    item.date = Timestamp.now();

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

  showSingleImageModal = () => {
    this.isSingleImageVisible$.next(true);
  }

  closeSingleImageModal = () => {
    this.isSingleImageVisible$.next(false);
  }

}

