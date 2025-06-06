import { Component, OnInit, ViewChild } from '@angular/core';
import { DxDataGridComponent, DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { AppUser } from 'impactdisciplescommon/src/models/admin/appuser.model';
import { AppUserService } from 'impactdisciplescommon/src/services/data/user.service';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { Address } from 'impactdisciplescommon/src/models/domain/utils/address.model';
import { Phone } from 'impactdisciplescommon/src/models/domain/utils/phone.model';
import { Workbook } from 'exceljs';
import { exportDataGrid as exportXLSDataGrid} from 'devextreme/excel_exporter';
import { saveAs } from 'file-saver';

@Component({
  selector: 'app-users',
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss']
})
export class UsersComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;
  @ViewChild('userGrid', { static: false }) userGrid: DxDataGridComponent;

  datasource$: Observable<DataSource>;
  selectedItem: AppUser;

  itemType = 'User';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);


  phoneEditorOptions = {
    mask: '(X00) 000-0000',
    maskRules: {
      X: /[02-9]/,
    },
    maskInvalidMessage: 'The phone must have a correct USA phone format',
    valueChangeEvent: 'keyup',
  };

  public states: string[];
  public countries: string[];
  public roles: string[];
  public phone_types: string[];

  constructor(private service: AppUserService) {}

  ngOnInit(): void {
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
    );

    this.roles = EnumHelper.getRoleTypesAsArray();
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

    if(!this.selectedItem.billingAddress){
      this.selectedItem.billingAddress = {... new Address()};
    }

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new AppUser()};
    this.selectedItem.shippingAddress = {... new Address()};
    this.selectedItem.billingAddress = {... new Address()};
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

  onSave(item: AppUser) {
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

  exportXLSGrid = () => {
    const context = this;

    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Attendees');

    exportXLSDataGrid({
      component: context.userGrid.instance,
      worksheet,
      autoFilterEnabled: true,
    }).then(() => {
      workbook.xlsx.writeBuffer().then((buffer) => {
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'impact_users.xlsx');
      });
    });
  }
}
