import { Component, OnInit, ViewChild } from '@angular/core';
import { DxDataGridComponent, DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { BehaviorSubject, Observable, map, of, take } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { Address } from 'impactdisciplescommon/src/models/domain/utils/address.model';
import { Phone } from 'impactdisciplescommon/src/models/domain/utils/phone.model';
import { CustomerService } from 'impactdisciplescommon/src/services/data/customer.service';
import { CustomerModel } from 'impactdisciplescommon/src/models/domain/utils/customer.model';
import { PurchasesService } from 'impactdisciplescommon/src/services/data/purchases.service';
import { EventModel } from 'impactdisciplescommon/src/models/domain/event.model';
import { EventRegistrationModel } from 'impactdisciplescommon/src/models/domain/event-registration.model';
import { OrganizationService } from 'impactdisciplescommon/src/services/data/organization.service';
import { OrganizationModel } from 'impactdisciplescommon/src/models/domain/organization.model';
import { LocationModel } from 'impactdisciplescommon/src/models/domain/location.model';
import { CheckoutForm } from 'impactdisciplescommon/src/models/utils/cart.model';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { AuthService } from 'impactdisciplescommon/src/services/utils/auth.service';
import { EmailList } from 'impactdisciplescommon/src/models/utils/email-list.model';
import { Timestamp } from 'firebase/firestore';
import { CustomerEmailModel } from 'impactdisciplescommon/src/models/domain/customer-email.model';
import { EMailService } from 'impactdisciplescommon/src/services/data/email.service';
import { ToastrService } from 'ngx-toastr';
import { CustomerEmailService } from 'impactdisciplescommon/src/services/data/customer-email.service';
import { environment } from 'src/environments/environment';
import { CustomerNoteModel } from 'impactdisciplescommon/src/models/domain/utils/customer-note.model';
import { AppUser } from 'impactdisciplescommon/src/models/admin/appuser.model';
import { exportDataGrid } from 'devextreme/pdf_exporter';
import jsPDF from 'jspdf';
import { EmailListService } from 'impactdisciplescommon/src/services/data/email-list.service';
import { EventRegistrationService } from 'impactdisciplescommon/src/services/data/event-registration.service';
import { EventService } from 'impactdisciplescommon/src/services/data/event.service';
import { LocationService } from 'impactdisciplescommon/src/services/data/location.service';

@Component({
  selector: 'app-customers',
  templateUrl: './customers.component.html',
  styleUrls: ['./customers.component.scss']
})
export class CustomersComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;
  @ViewChild('customerGrid', { static: false }) customerGrid: DxDataGridComponent;

  datasource$: Observable<DataSource>;
  salesDatasource$: Observable<DataSource>;
  eventsRegistrantsDatasource$: Observable<DataSource>;

  public isSalesEditVisible$ = new BehaviorSubject<boolean>(false);
  public isRegistrationEditVisible$ = new BehaviorSubject<boolean>(false);
  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);
  public isListVisible$ = new BehaviorSubject<boolean>(false);
  public isEmailVisible$ = new BehaviorSubject<boolean>(false);

  user: AppUser
  selectedItem: CustomerModel;
  selectedPurchase: CheckoutForm;
  selectedEvent: EventModel;
  selectedRows: string[] = [];
  selectedCustomers: CustomerModel[] = [];
  selectedList: EmailList;
  emailLists: EmailList[];
  events: EventModel[];
  email: CustomerEmailModel
  public locations: LocationModel[];
  public organizations: OrganizationModel[];

  itemType = 'Customer';

  emailVals: string[] = ['Recipient First Name', 'Recipient Last Name', 'Sender First Name', 'Sender Last Name', 'Date'];

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
  public phone_types: string[];

  constructor(private service: CustomerService,
    private salesService: PurchasesService,
    private eventService: EventService,
    private eventRegistrationService: EventRegistrationService,
    private locationsService: LocationService,
    private organizationsService: OrganizationService,
    private authService: AuthService,
    private emailListService: EmailListService,
    private emailService: EMailService,
    private toastrService: ToastrService,
    private customerEmailService: CustomerEmailService
  ) {}

  async ngOnInit(): Promise<void> {
    this.user = await this.authService.getUserAsPromise() as AppUser;

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

    this.events = await this.eventService.getAll();

    this.emailLists = await this.emailListService.getAllByValue('type', 'customer').then(list => {
      if (list){
        return list;
      } else {
        return [];
      }
    });

    this.phone_types = EnumHelper.getPhoneTypesAsArray();
    this.states = EnumHelper.getStateTypesAsArray();
    this.countries = EnumHelper.getCountryTypesAsArray();
  }

  onListFilterChanged(event: any) {
    if(event.value) {
      this.selectedRows = [];

      this.selectedList = this.emailLists.find(list => list.id === event.value) || null;

      this.selectedList.list.forEach(item => {
        this.selectedRows.push(item.id)
      })
    } else if(!event.value) {
      this.selectedList = {... new EmailList()};
      this.selectedRows = [];
    }
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

    if(!this.selectedItem.notes){
      this.selectedItem.notes = [];
    }

    this.salesDatasource$ = this.salesService.streamAllByValue("email", this.selectedItem.email).pipe(
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

    this.eventsRegistrantsDatasource$ = this.eventRegistrationService.streamAllByValue("email", this.selectedItem.email).pipe(
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

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new CustomerModel()};
    this.selectedItem.shippingAddress = {... new Address()};
    this.selectedItem.billingAddress = {... new Address()};
    this.selectedItem.phone = {... new Phone()};

    this.salesDatasource$ = of([]).pipe(
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

    this.eventsRegistrantsDatasource$ = of([]).pipe(
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

    this.isVisible$.next(true);
  }

  showListModal = () => {
    this.selectedList = {... new EmailList()};
    this.isListVisible$.next(true);
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

  save() {
    if(this.addEditForm.instance.validate().isValid) {
      this.inProgress$.next(true);

      if(this.selectedItem.id) {
        this.service.update(this.selectedItem.id, this.selectedItem).then((item) => {
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
        this.service.add(this.selectedItem).then((item) => {
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

  onListSave = () => {
    this.inProgress$.next(true);
    this.selectedList.list = this.selectedCustomers;
    this.selectedList.type = 'customer';

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

  onCancel() {
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  onEmailCancel() {
    this.email = null;
    this.inProgress$.next(false);
    this.isEmailVisible$.next(false);
  }

  onListCancel() {
    this.inProgress$.next(false);
    this.isListVisible$.next(false);
  }

  showPurchasesEditModal = ({ row: { data } }) => {
    this.selectedPurchase = (Object.assign({}, data));

    this.isSalesEditVisible$.next(true);
  }

  showRegistrationsEditModal = async ({ row: { data } }) => {
    if(!this.organizations){
      this.organizations = await this.organizationsService.getAll();
    }

    if(!this.locations){
      this.locations = await this.locationsService.getAll();
    }

    let registration: EventRegistrationModel = (Object.assign({}, data));

    this.selectedEvent = this.events.find(event => event.id == registration.eventId);
    this.selectedEvent.location = this.locations.find(location => location.id == this.selectedEvent.location);
    this.selectedEvent.organization = this.organizations.find(organization => organization.id == this.selectedEvent.organization);

    this.isRegistrationEditVisible$.next(true);
  }

  sendEmail(){
    this.authService.getUser().pipe(take(1)).subscribe(user => {
      this.email.sender = user.firstName + ' ' + user.lastName
      let html='';

      let list: Promise<CustomerModel[]>
      if(this.selectedList){
        list = Promise.resolve(this.selectedList.list);
      } else {
        list = this.service.getAll();
      }

      list.then(subscribers => {
        console.log(subscribers)
        subscribers.forEach(subscriber => {
          html = this.email.html
          html = html.replace('{{Recipient First Name}}', subscriber.firstName);
          html = html.replace('{{Recipient Last Name}}', subscriber.lastName);
          html = html.replace('{{Sender First Name}}', user.firstName);
          html = html.replace('{{Sender Last Name}}', user.lastName);
          html = html.replace('{{Date}}', (dateFromTimestamp(this.email.date) as Date).toLocaleString());
          html += "<br><br><br><div>If you believe you received this email by mistake, please click " +
            "<b><a href='" + environment.unsubscribeUrl + "?email="+ subscriber.email +
            "&list=newsletter_subscriptions'>here</a></b> to remove your address.</div>"
          this.email.html = html;

          this.emailService.sendHtmlEmail(subscriber.email, this.email.subject, this.email.html);
        })
      }).then(() => {
        this.customerEmailService.add(this.email).then(email => {
          this.toastrService.success('Email ("' + email.subject + '") Sent Successfully!');
          this.isEmailVisible$.next(false);
        })
      })
    })
  }

  getEventDate(cell){
    return (dateFromTimestamp(this.events.find(event => event.id == cell.data.eventId).startDate) as Date).toLocaleDateString();
  }

  getDate(item){
    return (dateFromTimestamp(item) as Date).toLocaleDateString();
  }

  selectRow(e){
    this.selectedCustomers = e.selectedRowsData;
  }

  addCustomerNote(){
    this.authService.getUser().pipe(take(1)).subscribe(user => {
      let note: CustomerNoteModel = {... new CustomerNoteModel()};
      note.date = Timestamp.now();
      note.addedBy = user.firstName + " " + user.lastName;
      note.private = false;
      note.id = this.generateRandomId();
      this.selectedItem.notes.push(note);
    })
  }

  deleteNote(index: number){
    confirm('<i>Are you sure you want to delete this note?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        this.selectedItem.notes.splice(index, 1);

        this.service.update(this.selectedItem.id, this.selectedItem).then((item) => {
          if(item) {
            notify({
              message: this.itemType + ' Updated',
              position: 'top',
              width: 600,
              type: 'success'
            });
          }
        })
      }
    })
  }

  saveNote(){
    this.service.update(this.selectedItem.id, this.selectedItem).then((item) => {
      if(item) {
        notify({
          message: this.itemType + ' Updated',
          position: 'top',
          width: 600,
          type: 'success'
        });
      }
    })
  }

  exportGrids = () => {
    const context = this;
    const doc = new jsPDF();

    exportDataGrid({
      selectedRowsOnly: true,
      jsPDFDocument: doc,
      component: context.customerGrid.instance,
      topLeft: { x: 7, y: 5 },
      columnWidths: [20, 50, 50, 50],

    }).then(() => {
        doc.save('customer_list.pdf');
    });
  }

  private generateRandomId() {
    return 'xxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
