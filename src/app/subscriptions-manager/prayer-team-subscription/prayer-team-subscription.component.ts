import { Timestamp } from 'firebase/firestore';
import { Component, ViewChild } from '@angular/core';
import ArrayStore from 'devextreme/data/array_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { PrayerTeamSubscriptionModel } from 'impactdisciplescommon/src/models/domain/prayer-team-subscription.model';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import { DxDataGridComponent, DxFormComponent } from 'devextreme-angular';
import { PrayerModel } from 'impactdisciplescommon/src/models/domain/prayer.model';
import { EMailService } from 'impactdisciplescommon/src/services/data/email.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { EmailList } from 'impactdisciplescommon/src/models/utils/email-list.model';
import { environment } from 'src/environments/environment';
import { exportDataGrid } from 'devextreme/pdf_exporter';
import jsPDF from 'jspdf';
import { EmailListService } from 'impactdisciplescommon/src/services/data/email-list.service';
import { PrayerTeamSubscriptionService } from 'impactdisciplescommon/src/services/data/prayer-team-subscription.service';
import { PrayerService } from 'impactdisciplescommon/src/services/data/prayer.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';

@Component({
  selector: 'app-prayer-team-subscription',
  templateUrl: './prayer-team-subscription.component.html',
  styleUrls: ['./prayer-team-subscription.component.css']
})
export class PrayerTeamSubscriptionComponent {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;
  @ViewChild('prayerTeamGrid', { static: false }) prayerTeamGrid: DxDataGridComponent;

  datasource$: Observable<DataSource>;
  selectedItem: PrayerTeamSubscriptionModel
  selectedRows: string[] = [];
  selectedSubscribers: PrayerTeamSubscriptionModel[] = [];

  selectedList: EmailList;
  emailLists: EmailList[];

  itemType = 'Prayer Team Subscription';

  emailVals: string[] = ['Recipient First Name', 'Recipient Last Name', 'Sender First Name', 'Sender Last Name', 'Date'];

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isEditVisible$ = new BehaviorSubject<boolean>(false);
  public isListVisible$ = new BehaviorSubject<boolean>(false);
  public isPrayerVisible$ = new BehaviorSubject<boolean>(false);

  prayer: PrayerModel;

  constructor(private service: PrayerTeamSubscriptionService,
    private emailService: EMailService,
    private authService: AdminAuthService,
    private prayerService: PrayerService,
    private emailListService: EmailListService) {}

   async ngOnInit() {
    this.datasource$ = this.service.streamAll().pipe(
      map(
        (data) =>
          new DataSource({
            reshapeOnPush: true,
            pushAggregationTimeout: 100,
            store: new ArrayStore({
              key: 'id',
              data
          })
        })
      )
    )

    this.emailLists = await this.emailListService.getAllByValue('type', 'prayer')
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));
    this.isEditVisible$.next(true);
  }

  showPrayerModal = () => {
    this.prayer = {... new PrayerModel()};
    this.prayer.date = Timestamp.now();
    this.isPrayerVisible$.next(true);
  }

  showAddModal = () => {
    this.isEditVisible$.next(true);
  }

  showListModal = () => {
    this.selectedList = {... new EmailList()};
    this.isListVisible$.next(true);
  }

  onListFilterChanged(event: any) {
    if(event.value) {
      this.selectedRows = [];

      this.selectedList = this.emailLists.find(list => list.id === event.value) || null;

      this.selectedList.list.forEach(item => {
        this.selectedRows.push(item.id)
      })
    } else if(!event.value) {
      this.selectedRows = [];
      this.selectedList = null;
    }
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

  onSave(item: PrayerTeamSubscriptionModel) {
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
        this.service.createPrayerTeamSubscription(item.firstName, item.lastName, item.email).then((item) => {
          if(item) {
            notify({
              message: this.itemType + ' Added',
              position: 'top',
              width: 600,
              type: 'success'
            });

            this.service.sendConfirmationEmail(this.selectedItem);

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

  onListSave = () => {
    this.inProgress$.next(true);
    this.selectedList.list = this.selectedSubscribers;
    this.selectedList.type = 'prayer';

    if(this.selectedList.id) {
      this.emailListService.update(this.selectedList.id, this.selectedList).then((item) => {
        if(item) {
          notify({
            message: 'List Updated',
            position: 'top',
            width: 600,
            type: 'success'
          });
          this.onListCancel();
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
      this.emailListService.add(this.selectedList).then((item) => {
        if(item) {
          notify({
            message: 'List Added',
            position: 'top',
            width: 600,
            type: 'success'
          });

          this.emailLists.push(item);
          this.onListCancel();
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

  sendPrayer(){
    let user = this.authService.getLoggedInUser()
    this.prayer.sender = user.firstName + ' ' + user.lastName
    let html='';

    let list: Promise<PrayerTeamSubscriptionModel[]>
    if(this.selectedList){
      list = Promise.resolve(this.selectedList.list);
    } else {
      list = this.service.getAll();
    }

    list.then(subscribers => {
      subscribers.forEach(subscriber => {
        let form = {};
        form['firstName'] = subscriber.firstName;
        form['lastName'] = subscriber.lastName;
        form['email'] = subscriber.email;
        form['date'] = subscriber;

        html = this.prayer.html
        html = html.replace('{{Recipient First Name}}', subscriber.firstName);
        html = html.replace('{{Recipient Last Name}}', subscriber.lastName);
        html = html.replace('{{Sender First Name}}', user.firstName);
        html = html.replace('{{Sender Last Name}}', user.lastName);
        html = html.replace('{{Date}}', (dateFromTimestamp(this.prayer.date) as Date).toLocaleString());
        html += "<br><br><br><div>If you believe you received this email by mistake, please click " +
          "<b><a href='" + environment.unsubscribeUrl + "?email="+ subscriber.email +
          "&list=prayer_team_subscriptions'>here</a></b> to remove your address.</div>"

        this.prayer.html = html;

        this.emailService.sendHtmlEmail(subscriber.email, this.prayer.subject, this.prayer.html);
      })
    }).then(() => {
      this.prayerService.add(this.prayer).then(prayer => {
        notify({
          message: 'Prayer Request Sent Successfully!',
          position: 'top',
          width: 600,
          type: 'success'
        });

        this.isPrayerVisible$.next(false);
      })
    })

  }

  onCancel() {
    this.selectedItem = null;
    this.inProgress$.next(false);
    this.isEditVisible$.next(false);
  }

  onPrayerCancel() {
    this.prayer = null;
    this.inProgress$.next(false);
    this.isPrayerVisible$.next(false);
  }

  onListCancel() {
    this.inProgress$.next(false);
    this.isListVisible$.next(false);
  }

  selectRow(e){
    this.selectedSubscribers = e.selectedRowsData;
  }

  exportGrids = () => {
    const context = this;
    const doc = new jsPDF();

    exportDataGrid({
      selectedRowsOnly: true,
      jsPDFDocument: doc,
      component: context.prayerTeamGrid.instance,
      topLeft: { x: 7, y: 5 },
      columnWidths: [20, 50, 50, 50],

    }).then(() => {
        doc.save('Prayer_team_subscribers.pdf');
    });
  }
}
