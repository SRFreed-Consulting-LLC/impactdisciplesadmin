import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { DxDataGridComponent, DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import { EventRegistrationModel } from 'impactdisciplescommon/src/models/domain/event-registration.model';
import { EventModel } from 'impactdisciplescommon/src/models/domain/event.model';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import notify from 'devextreme/ui/notify';
import { EmailList } from 'impactdisciplescommon/src/models/utils/email-list.model';
import { CustomerEmailModel } from 'impactdisciplescommon/src/models/domain/customer-email.model';
import { Timestamp, Unsubscribe } from 'firebase/firestore';
import { CustomerEmailService } from 'impactdisciplescommon/src/services/data/customer-email.service';
import { EMailService } from 'impactdisciplescommon/src/services/data/email.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { environment } from 'src/environments/environment';
import { exportDataGrid as exportPDFDataGrid} from 'devextreme/pdf_exporter';
import { exportDataGrid as exportXLSDataGrid} from 'devextreme/excel_exporter';
import jsPDF from 'jspdf';
import { saveAs } from 'file-saver';
import { Workbook } from 'exceljs';
import { EventRegistrationService } from 'impactdisciplescommon/src/services/data/event-registration.service';

@Component({
  selector: 'app-event-attendees',
  templateUrl: './event-attendees.component.html',
  styleUrls: ['./event-attendees.component.css']
})
export class EventAttendeesComponent implements OnInit{
  @Input('event') event: EventModel;

  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;
  @ViewChild('attendeeGrid', { static: false }) attendeeGrid: DxDataGridComponent;

  datasource$: Observable<DataSource>;
  selectedItem: EventRegistrationModel;
  selectedRows: string[] = [];
  selectedCustomers: EventRegistrationModel[] = [];
  selectedList: EmailList;
  email: CustomerEmailModel

  itemType = 'Registered User';

  emailVals: string[] = ['Recipient First Name', 'Recipient Last Name', 'Sender First Name', 'Sender Last Name', 'Date'];

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);
  public isEmailVisible$ = new BehaviorSubject<boolean>(false);

  public unsub: Unsubscribe;

  constructor(public service: EventRegistrationService,
    private authService: AdminAuthService,
    private emailService: EMailService,
    private customerEmailService: CustomerEmailService
  ){}

  async ngOnInit(): Promise<void> {
    if(this.event?.id){
      this.datasource$ = this.service.streamAllByValue('eventId', this.event.id).pipe(
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
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));

    if(this.selectedItem.receiptEmailId){
      let callBack = (mail) => {

        if(mail['delivery']){
          this.selectedItem.receiptEmailStatus = mail['delivery']['state'];
          this.selectedItem.receiptEmailDate = dateFromTimestamp(mail['delivery']['endTime'] as Timestamp);
        }

      }

      this.unsub = this.emailService.streamRecord(this.selectedItem.receiptEmailId, callBack)

    } else {
      this.selectedItem.receiptEmailStatus = 'N/A';
    }

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new EventRegistrationModel()};

    this.isVisible$.next(true);
  }

  showEmailModal = () => {
    this.email = {... new CustomerEmailModel()};
    this.email.date = Timestamp.now();
    this.isEmailVisible$.next(true);
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

  onSave(item: EventRegistrationModel) {
    item.eventId = this.event.id;
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

  sendEmail(){
    let user = this.authService.getLoggedInUser();

    this.email.sender = user.firstName + ' ' + user.lastName

    let html='';

    let list: Promise<EventRegistrationModel[]>

    this.service.getAllByValue('eventId', this.event.id).then(subscribers => {
      subscribers.forEach(subscriber => {
        html = this.email.html
        html = html.replace('{{Recipient First Name}}', subscriber.firstName);
        html = html.replace('{{Recipient Last Name}}', subscriber.lastName);
        html = html.replace('{{Sender First Name}}', user.firstName);
        html = html.replace('{{Sender Last Name}}', user.lastName);
        html = html.replace('{{Date}}', (dateFromTimestamp(this.email.date) as Date).toLocaleString());
        this.email.html = html;

        let unsubscribe = "<br><br><br><div>If you believe you received this email by mistake, please click " +
          "<b><a href='" + environment.unsubscribeUrl + "?email="+ subscriber.email +
          "&list=newsletter_subscriptions'>here</a></b> to remove your address.</div>"

        this.emailService.sendHtmlEmail(subscriber.email, this.email.subject, this.email.html + unsubscribe);
      })
    }).then(() => {
      this.customerEmailService.add(this.email).then(email => {
        notify({
          message: 'Email ("' + email.subject + '") Sent Successfully!',
          position: 'top',
          width: 600,
          type: 'success'
        });

        this.isEmailVisible$.next(false);
      })
    })
  }

  onCancel() {
    this.selectedItem = null;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  onEmailCancel() {
    this.email = null;
    this.inProgress$.next(false);
    this.isEmailVisible$.next(false);
  }

  selectRow(e){
    this.selectedCustomers = e.selectedRowsData;
  }

  exportPDFGrid = () => {
    const context = this;
    const doc = new jsPDF();

    exportPDFDataGrid({
      selectedRowsOnly: true,
      jsPDFDocument: doc,
      component: context.attendeeGrid.instance,
      topLeft: { x: 7, y: 5 },
      columnWidths: [20, 50, 50, 50],

    }).then(() => {
        doc.save('attendee_list.pdf');
    });
  }

  exportXLSGrid = () => {
    const context = this;

    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Attendees');

    exportXLSDataGrid({
      component: context.attendeeGrid.instance,
      worksheet,
      autoFilterEnabled: true,
    }).then(() => {
      workbook.xlsx.writeBuffer().then((buffer) => {
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'attendee_list.xlsx');
      });
    });
  }

  showColumnChooser = () => {
    this.attendeeGrid.instance.showColumnChooser()
  }

  resendEmail(){
    this.emailService.getById(this.selectedItem.receiptEmailId).then(mail =>{
      delete mail['delivery'];

      return mail;
    }).then(mail => {
      this.emailService.update(mail.id, mail);
    })
  }
}
