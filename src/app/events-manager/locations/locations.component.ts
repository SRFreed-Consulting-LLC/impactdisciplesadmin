import { Component, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { confirm } from 'devextreme/ui/dialog';
import { PHONE_TYPES } from 'impactdisciplescommon/src/lists/phone_types.enum';
import { LocationModel } from 'impactdisciplescommon/src/models/domain/location.model';
import { OrganizationModel } from 'impactdisciplescommon/src/models/domain/organization.model';
import { OrganizationService } from 'impactdisciplescommon/src/services/data/organization.service';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { Phone } from 'impactdisciplescommon/src/models/domain/utils/phone.model';
import { Address } from 'impactdisciplescommon/src/models/domain/utils/address.model';
import { LocationService } from 'impactdisciplescommon/src/services/data/location.service';

@Component({
    selector: 'app-locations',
    templateUrl: './locations.component.html',
    styleUrls: ['./locations.component.css'],
    standalone: false
})
export class LocationsComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  datasource$: Observable<DataSource>;
  selectedItem: LocationModel;

  itemType = 'Location';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);

  phone_types: PHONE_TYPES[];

  organizations: OrganizationModel[];

  public states: string[];

  phoneEditorOptions = {
    mask: '(X00) 000-0000',
    maskRules: {
      X: /[02-9]/,
    },
    maskInvalidMessage: 'The phone must have a correct USA phone format',
    valueChangeEvent: 'keyup',
  };

  constructor(public service: LocationService, private organizationService: OrganizationService){}

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
              },
            })
          })
      )
    )
    this.phone_types = EnumHelper.getPhoneTypesAsArray();
    this.organizations = await this.organizationService.getAll();
    this.states = EnumHelper.getStateTypesAsArray();
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));

    if(!this.selectedItem.phone){
      this.selectedItem.phone = {... new Phone()};
    }

    if(!this.selectedItem.address){
      this.selectedItem.address = {... new Address()};
    }

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new LocationModel()};
    this.selectedItem.phone = {... new Phone()};
    this.selectedItem.address = {... new Address()};
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

  onSave(item: LocationModel) {
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
}
