import { Component, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import { DxButtonTypes } from 'devextreme-angular/ui/button';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { Functions, getFunctions, HttpsCallable, httpsCallable } from "firebase/functions";
import { NotificationRegistrationModel } from 'impactdisciplescommon/src/models/admin/notification-registration.model';
import { NotificationRegistrationService } from 'impactdisciplescommon/src/services/data/notification-registration.service';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';


@Component({
    selector: 'app-notifications',
    templateUrl: './notifications.component.html',
    styleUrls: ['./notifications.component.css'],
    standalone: false
})
export class NotificationsComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  datasource$: Observable<DataSource>;
  selectedItem: NotificationRegistrationModel;

  itemType = 'Notifications';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);

  functions: Functions;

  addMessageFunction: HttpsCallable;

  title: string = '';
  body: string = '';

  constructor(private service: NotificationRegistrationService) {
    this.functions = getFunctions();
    this.addMessageFunction = httpsCallable(this.functions, 'sendNotification');
   }

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
  }

  showEditModal = ({ row: { data } }) => {
    this.selectedItem = data
    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new NotificationRegistrationModel()};
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

  onSave() {
    if(this.addEditForm.instance.validate().isValid) {
      this.inProgress$.next(true);
      notify({
        message: this.itemType + ' Sent',
        position: 'top',
        width: 600,
        type: 'success'
      });
      setTimeout(() => {
        this.sendMessage();

        notify({
          message: this.itemType + ' Sent',
          position: 'top',
          width: 600,
          type: 'success'
        });
      }, 5000);

      this.onCancel();

    }
  }

  onCancel() {
    this.selectedItem = null;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  sendMessage(){
    this.addMessageFunction({ title: this.title, body: this.body, token: this.selectedRegistration.fcmId }).then((result: any) => {
      this.body = '';
      this.title = '';
    });
  }

  clearForm(){
    this.body = '';
    this.title = '';
  }

  selectedRegistration: NotificationRegistrationModel;

  showSendMessage(e){
    this.selectedRegistration = e.row.data;
    this.onCancel();
  }
}

