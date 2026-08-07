import { OrganizationService } from 'impactdisciplescommon/src/services/data/organization.service';
import { Component, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { confirm } from 'devextreme/ui/dialog';
import { PHONE_TYPES } from 'impactdisciplescommon/src/lists/phone_types.enum';
import { CoachModel } from 'impactdisciplescommon/src/models/domain/coach.model';
import { OrganizationModel } from 'impactdisciplescommon/src/models/domain/organization.model';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { BehaviorSubject, map, Observable, tap } from 'rxjs';
import { Phone } from 'impactdisciplescommon/src/models/domain/utils/phone.model';
import { Address } from 'impactdisciplescommon/src/models/domain/utils/address.model';
import { CoachService } from 'impactdisciplescommon/src/services/data/coach.service';
import { DxDataGridTypes } from 'devextreme-angular/ui/data-grid';

@Component({
    selector: 'app-coaches',
    templateUrl: './coaches.component.html',
    styleUrls: ['./coaches.component.css'],
    standalone: false
})
export class CoachesComponent implements OnInit{
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  datasource$: Observable<DataSource>;
  selectedItem: CoachModel;

  itemType = 'Coach';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);

  public isSingleImageVisible$ = new BehaviorSubject<boolean>(false);

  organizations: OrganizationModel[];
  public states: string[];
  public countries: string[];
  phone_types: PHONE_TYPES[];

  constructor(public service: CoachService, private organizationService: OrganizationService){}

  async ngOnInit(): Promise<void> {
    this.datasource$ = this.service.streamAll().pipe(
      map((coaches) => coaches.sort((a, b) => a.sortOrder - b.sortOrder)),
      map(
        (items) =>
          new DataSource({
            reshapeOnPush: true,
            pushAggregationTimeout: 100,
            store: new CustomStore({
              key: 'id',
              loadMode: 'raw',
              load: function (loadOptions: any) {
                return items.sort((a,b) => a.sortOrder - b.sortOrder)
              }
            })
          })
      )
    );

    this.organizations = await this.organizationService.getAll();

    this.phone_types = EnumHelper.getPhoneTypesAsArray();
    this.states = EnumHelper.getStateTypesAsArray();
    this.countries = EnumHelper.getCountryTypesAsArray();
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));

    if(!this.selectedItem.phone){
      this.selectedItem.phone = {... new Phone()};
    }

    if(!this.selectedItem.shippingAddress){
      this.selectedItem.shippingAddress = {... new Address()};
    }

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new CoachModel()};
    this.selectedItem.shippingAddress = {... new Address()}
    this.selectedItem.phone = {... new Phone()};

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

  onSave(item: CoachModel) {
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
