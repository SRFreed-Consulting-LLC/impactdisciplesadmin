import { Component, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import { PHONE_TYPES } from 'impactdisciplescommon/src/lists/phone_types.enum';
import { SeminarModel } from 'impactdisciplescommon/src/models/domain/seminar.model';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { BehaviorSubject, Observable, map } from 'rxjs';
import notify from 'devextreme/ui/notify';
import { confirm } from 'devextreme/ui/dialog';
import { Phone } from 'impactdisciplescommon/src/models/domain/utils/phone.model';
import { Address } from 'impactdisciplescommon/src/models/domain/utils/address.model';
import { CoachModel } from 'impactdisciplescommon/src/models/domain/coach.model';
import { CoachService } from 'impactdisciplescommon/src/services/data/coach.service';
import { SeminarService } from 'impactdisciplescommon/src/services/data/seminar.service';

@Component({
  selector: 'app-seminars',
  templateUrl: './seminars.component.html',
  styleUrls: ['./seminars.component.css']
})
export class SeminarsComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  datasource$: Observable<DataSource>;
  selectedItem: SeminarModel;

  itemType = 'Seminar Request';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);

  coaches$: Observable<CoachModel[]>;

  phone_types: PHONE_TYPES[];

  public states: string[];

  phoneEditorOptions = {
    mask: '(X00) 000-0000',
    maskRules: {
      X: /[02-9]/,
    },
    maskInvalidMessage: 'The phone must have a correct USA phone format',
    valueChangeEvent: 'keyup',
  };

  constructor(private service: SeminarService, private coachService: CoachService) {}

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

    this.phone_types = EnumHelper.getPhoneTypesAsArray();
    this.states = EnumHelper.getStateTypesAsArray();

    this.coaches$ = this.coachService.streamAll().pipe(
      map(coaches => {
        coaches.forEach(coach => coach.fullname = coach.firstName + ' ' + coach.lastName)

        return coaches;
      })
    );
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));

    if(!this.selectedItem.phone){
      this.selectedItem.phone = {... new Phone()};
    }

    if(!this.selectedItem.preferredLocation){
      this.selectedItem.preferredLocation = {... new Address()};
    }

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new SeminarModel()};
    this.selectedItem.phone = {... new Phone()};
    this.selectedItem.preferredLocation = {... new Address()};

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

  onSave(item: SeminarModel) {
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
