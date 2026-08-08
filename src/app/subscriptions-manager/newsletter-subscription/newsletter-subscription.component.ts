import { Component, ViewChild } from '@angular/core';
import ArrayStore from 'devextreme/data/array_store';
import DataSource from 'devextreme/data/data_source';
import { NewsletterSubscriptionModel } from 'impactdisciplescommon/src/models/domain/newsletter-subscription.model';
import { BehaviorSubject, Observable, map, take } from 'rxjs';
import notify from 'devextreme/ui/notify';
import { confirm } from 'devextreme/ui/dialog';
import { DxDataGridComponent, DxFormComponent } from 'devextreme-angular';
import { Timestamp } from 'firebase/firestore';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { EMailService } from 'impactdisciplescommon/src/services/data/email.service';
import { NewsletterModel } from 'impactdisciplescommon/src/models/domain/newsletter.model';
import { EmailList } from 'impactdisciplescommon/src/models/utils/email-list.model';
import { environment } from 'src/environments/environment';
import { exportDataGrid } from 'devextreme/pdf_exporter';
import jsPDF from 'jspdf';
import { EmailListService } from 'impactdisciplescommon/src/services/data/email-list.service';
import { NewsletterService } from 'impactdisciplescommon/src/services/data/newletter.service';
import { NewsletterSubscriptionService } from 'impactdisciplescommon/src/services/data/newsletter-subscription.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';

@Component({
    selector: 'app-newsletter-subscription',
    templateUrl: './newsletter-subscription.component.html',
    styleUrls: ['./newsletter-subscription.component.scss'],
    standalone: false
})
export class NewsletterSubscriptionComponent {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;
  @ViewChild('subscriptionGrid', { static: false }) subscriptionGrid: DxDataGridComponent;

  datasource$: Observable<DataSource>;
  selectedItem: NewsletterSubscriptionModel;
  selectedRows: string[] = [];
  selectedSubscribers: NewsletterSubscriptionModel[] = [];
  selectedList: EmailList;
  emailLists: EmailList[];

  newsletter: NewsletterModel;

  itemType = 'Newsletter Subscription';

  emailVals: string[] = ['Recipient First Name', 'Recipient Last Name', 'Sender First Name', 'Sender Last Name', 'Date'];

  freeEbookUrl = environment.freeEbookUrl;

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);
  public isListVisible$ = new BehaviorSubject<boolean>(false);
  public isPrayerVisible$ = new BehaviorSubject<boolean>(false);

  gridFilter: any = null;

  constructor(private service: NewsletterSubscriptionService,
    private emailService: EMailService,
    private authService: AdminAuthService,
    private newsletterService: NewsletterService,
    private emailListService: EmailListService
  ) {}

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

    this.emailLists = await this.emailListService.getAllByValue('type', 'newsletter')
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));
    this.isVisible$.next(true);
  }

  showNewletterModal = () => {
    this.newsletter = {... new NewsletterModel()};
    this.newsletter.date = Timestamp.now();
    this.isPrayerVisible$.next(true);
  }

  showAddModal = () => {
    this.isVisible$.next(true);

    this.selectedList = {... new EmailList()};
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
      this.selectedList = {... new EmailList()};
      this.selectedRows = [];
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

  onSave(item: NewsletterSubscriptionModel) {
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
        this.service.createNewsLetterSubscription(item.firstName, item.lastName, item.email).then((item) => {
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
    this.selectedList.type = 'newsletter';

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

  sendNewsletter(){
    let user = this.authService.getLoggedInUser();
    this.newsletter.sender = user.firstName + ' ' + user.lastName
    let html='';

    let list: Promise<NewsletterSubscriptionModel[]>
    if(this.selectedList){
      list = Promise.resolve(this.selectedList.list);
    } else {
      list = this.service.getAll();
    }

    list.then(subscribers => {
      subscribers.forEach(subscriber => {
        html = this.newsletter.html
        html = html.replace('{{Recipient First Name}}', subscriber.firstName);
        html = html.replace('{{Recipient Last Name}}', subscriber.lastName);
        html = html.replace('{{Sender First Name}}', user.firstName);
        html = html.replace('{{Sender Last Name}}', user.lastName);
        html = html.replace('{{Date}}', (dateFromTimestamp(this.newsletter.date) as Date).toLocaleString());
        html += "<br><br><br><div>If you believe you received this email by mistake, please click " +
          "<b><a href='" + environment.unsubscribeUrl + "?email="+ subscriber.email +
          "&list=newsletter_subscriptions'>here</a></b> to remove your address.</div>"
        this.newsletter.html = html;

        this.emailService.sendHtmlEmail(subscriber.email, this.newsletter.subject, this.newsletter.html);
      })
    }).then(() => {
      this.newsletterService.add(this.newsletter).then(newsletter => {
        notify({
          message: 'Newsletter ("' + newsletter.subject + '") Sent Successfully!',
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
    this.isVisible$.next(false);
  }

  onNewsletterCancel() {
    this.newsletter = null;
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
      component: context.subscriptionGrid.instance,
      topLeft: { x: 7, y: 5 },
      columnWidths: [20, 50, 50, 50],

    }).then(() => {
        doc.save('Newsletter_subscribers.pdf');
    });
  }
}
