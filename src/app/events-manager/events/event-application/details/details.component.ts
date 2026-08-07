import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { AnnouncementModel } from 'impactdisciplescommon/src/models/domain/announcement.model.ts';
import { EventModel } from 'impactdisciplescommon/src/models/domain/event.model';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import notify from 'devextreme/ui/notify';
import { EventAnnouncementService } from 'impactdisciplescommon/src/services/data/event-announcement.service';
import DataSource from 'devextreme/data/data_source';
import CustomStore from 'devextreme/data/custom_store';
import { DxFormComponent } from 'devextreme-angular';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { Timestamp } from 'firebase/firestore';

@Component({
    selector: 'app-details',
    templateUrl: './details.component.html',
    styleUrls: ['./details.component.css'],
    standalone: false
})
export class DetailsComponent implements OnInit {
  @Input('event') event: EventModel;
  @ViewChild('form', { static: false }) form: DxFormComponent;

  datasource$: Observable<DataSource>;

  selectedItem: AnnouncementModel;
  itemType = 'Event Detail';

  public isVisible$ = new BehaviorSubject<boolean>(false);
  public inProgress$ = new BehaviorSubject<boolean>(false)

  constructor(private service: EventAnnouncementService,
    private authService: AdminAuthService
  ) { }

  ngOnInit() {
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

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new AnnouncementModel()};

    this.isVisible$.next(true);
  }

  onCancel() {
    this.selectedItem = null;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  delete = ({ row: { data } }) => {
    confirm('<i>Are you sure you want to delete this announcement?</i>', 'Confirm').then((dialogResult) => {
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
  async onSave(item: AnnouncementModel) {
    item.eventId = this.event.id;

    if(this.form.instance.validate().isValid) {
      item.date = Timestamp.now();

      let user = this.authService.getLoggedInUser()

      item.sentBy = user.firstName + ' ' + user.lastName;

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

}
