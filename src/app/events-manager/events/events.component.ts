import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DxDropDownBoxComponent, DxFormComponent } from 'devextreme-angular';
import { EventModel } from 'impactdisciplescommon/src/models/domain/event.model';
import { OrganizationService } from 'impactdisciplescommon/src/services/data/organization.service';
import { OrganizationModel } from 'impactdisciplescommon/src/models/domain/organization.model';
import { LocationModel } from 'impactdisciplescommon/src/models/domain/location.model';
import { BehaviorSubject, map, Observable, Subject, takeUntil } from 'rxjs';
import DataSource from 'devextreme/data/data_source';
import ArrayStore from 'devextreme/data/array_store';
import notify from 'devextreme/ui/notify';
import { confirm } from 'devextreme/ui/dialog';
import { Actions, ofActionSuccessful, Store } from '@ngxs/store';
import { LocationSaved, ShowLocationModal } from 'src/app/shared/location-modal/location-modal.actions';
import { OrganizationSaved, ShowOrganizationModal } from 'src/app/shared/organization-modal/organization-modal.actions';
import { EMailTemplatesService } from 'impactdisciplescommon/src/services/data/email-templates.service';
import { EventService } from 'impactdisciplescommon/src/services/data/event.service';
import { LocationService } from 'impactdisciplescommon/src/services/data/location.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';

@Component({
  selector: 'app-events',
  templateUrl: './events.component.html',
  styleUrls: ['./events.component.css']
})
export class EventsComponent implements OnInit, OnDestroy {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;
  @ViewChild('locationDropbox', { static: false }) locationDropbox: DxDropDownBoxComponent;
  @ViewChild('organizationDropbox', { static: false }) organizationDropbox: DxDropDownBoxComponent;

  organizations$: Observable<OrganizationModel[]>;
  locations$: Observable<LocationModel[]>;
  datasource$: Observable<DataSource>;
  selectedItem: EventModel;
  itemType = 'Event';
  selectedLocation = [];
  emailTemplates: string[] = []

  public isOrganizationModalVisible$ = new BehaviorSubject<boolean>(false);
  public isLocationModalVisible$ = new BehaviorSubject<boolean>(false);
  public inProgress$ = new BehaviorSubject<boolean>(false);
  public isVisible$ = new BehaviorSubject<boolean>(false);
  public isSingleImageVisible$ = new BehaviorSubject<boolean>(false);

  private ngUnsubscribe = new Subject<void>();

  constructor(private authService: AdminAuthService,
    private store: Store,
    private actions$: Actions,
    public eventService: EventService,
    private organizationService: OrganizationService,
    private locationService: LocationService,
    private emailTemplateService: EMailTemplatesService){}

  async ngOnInit(): Promise<void> {
    this.organizations$ = this.organizationService.streamAll();
    this.locations$ = this.locationService.streamAll();
    this.datasource$ = this.eventService.streamAll().pipe(
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
    );
    this.actions$.pipe(ofActionSuccessful(LocationSaved), takeUntil(this.ngUnsubscribe)).subscribe(({ location }) => {
      const selectedLocationEvent = { itemData: location };
      this.selectLocation(selectedLocationEvent);
    })
    this.actions$.pipe(ofActionSuccessful(OrganizationSaved), takeUntil(this.ngUnsubscribe)).subscribe(({ organization }) => {
      const selectedOrganizationEvent = { itemData: organization };
      this.selectOrganization(selectedOrganizationEvent);
    })

    this.emailTemplates = await this.emailTemplateService.getAll().then(templates => {
      let list = [];
      templates.forEach(template => list.push(template.name))
      return list;
    })
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));
    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new EventModel()};
    this.isVisible$.next(true);
  }

  selectLocation(event: any) {
    if (event && event.itemData) {
      this.selectedItem.location = event.itemData.id;
      this.locationDropbox.instance.close();
    }
  }

  selectOrganization(event: any) {
    if (event && event.itemData) {
      this.selectedItem.organization = event.itemData.id;
      this.organizationDropbox.instance.close();
    }
  }

  showAddLocationModal = () => {
    this.store.dispatch(new ShowLocationModal());
  }

  showAddOrganizationModal = () => {
    this.store.dispatch(new ShowOrganizationModal());
  }

  delete = ({ row: { data } }) => {
    confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        this.eventService.delete(data.id).then(() => {
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

  onSave(item: EventModel) {
    if(this.addEditForm.instance.validate().isValid) {
      this.inProgress$.next(true);

      if(item.id) {
        this.eventService.update(item.id, item).then((item) => {
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
        this.eventService.add(item).then((item) => {
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
    this.selectedItem = undefined;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  ngOnDestroy() {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }


  showSingleImageModal = () => {
    this.isSingleImageVisible$.next(true);
  }

  closeSingleImageModal = () => {
    this.isSingleImageVisible$.next(false);
  }

  isVisible(roles: string[]): boolean {
    let userRole = this.authService.getLoggedInUser().role;

    return roles.filter(role => role == userRole).length > 0;
  }
}
