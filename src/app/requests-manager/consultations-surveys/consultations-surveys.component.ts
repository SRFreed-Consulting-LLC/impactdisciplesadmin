import { Component, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { confirm } from 'devextreme/ui/dialog';
import { PHONE_TYPES } from 'impactdisciplescommon/src/lists/phone_types.enum';
import { ConsultationSurveyModel } from 'impactdisciplescommon/src/models/domain/consultation-survey.model';
import { ConsultationSurveyService } from 'impactdisciplescommon/src/services/data/consultation-survey.service';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { Phone } from 'impactdisciplescommon/src/models/domain/utils/phone.model';
import { Address } from 'impactdisciplescommon/src/models/domain/utils/address.model';

@Component({
    selector: 'app-consultations-surveys',
    templateUrl: './consultations-surveys.component.html',
    styleUrls: ['./consultations-surveys.component.css'],
    standalone: false
})
export class ConsultationsSurveysComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  datasource$: Observable<DataSource>;
  selectedItem: ConsultationSurveyModel;

  itemType = 'Consultation Survey';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);

  phone_types: PHONE_TYPES[];

  phoneEditorOptions = {
    mask: '(X00) 000-0000',
    maskRules: {
      X: /[02-9]/,
    },
    maskInvalidMessage: 'The phone must have a correct USA phone format',
    valueChangeEvent: 'keyup',
  };

  public states: string[];

  constructor(private service: ConsultationSurveyService) {}

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

    this.phone_types = EnumHelper.getPhoneTypesAsArray();
    this.states = EnumHelper.getStateTypesAsArray();
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));

    if(!this.selectedItem.location){
      this.selectedItem.location = {... new Address()};
    }

    if(!this.selectedItem.phone){
      this.selectedItem.phone = {... new Phone()};
    }

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new ConsultationSurveyModel()};
    this.selectedItem.location = {... new Address()};
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

  onSave(item: ConsultationSurveyModel) {
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
