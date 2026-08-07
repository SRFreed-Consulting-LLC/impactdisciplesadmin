import { Component, Input, OnInit } from '@angular/core';
import { Actions, ofActionSuccessful, Store } from '@ngxs/store';
import { LocationModel } from 'impactdisciplescommon/src/models/domain/location.model';
import { BehaviorSubject, Observable, Subject, takeUntil } from 'rxjs';
import { LocationSaved, ShowLocationModal } from './location-modal.actions';
import notify from 'devextreme/ui/notify';
import { PHONE_TYPES } from 'impactdisciplescommon/src/lists/phone_types.enum';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { OrganizationModel } from 'impactdisciplescommon/src/models/domain/organization.model';
import { OrganizationService } from 'impactdisciplescommon/src/services/data/organization.service';
import { LocationService } from 'impactdisciplescommon/src/services/data/location.service';

@Component({
    selector: 'app-location-modal',
    templateUrl: './location-modal.component.html',
    styleUrls: ['./location-modal.component.css'],
    standalone: false
})
export class LocationModalComponent implements OnInit {
  phone_types: PHONE_TYPES[];
  organizations$: Observable<OrganizationModel[]>;
  phoneEditorOptions = {
    mask: '(X00) 000-0000',
    maskRules: {
      X: /[02-9]/,
    },
    maskInvalidMessage: 'The phone must have a correct USA phone format',
    valueChangeEvent: 'keyup',
  };

  public location: LocationModel;
  public inProgress$ = new BehaviorSubject<boolean>(false);
  public isVisible$ = new BehaviorSubject<boolean>(false);

  private ngUnsubscribe = new Subject<void>();

  constructor(private actions$: Actions, private store: Store, public locationService: LocationService, private organizationService: OrganizationService){}

  ngOnInit(): void {
    this.phone_types = EnumHelper.getPhoneTypesAsArray();
    this.organizations$ = this.organizationService.streamAll();
    this.actions$.pipe(ofActionSuccessful(ShowLocationModal), takeUntil(this.ngUnsubscribe)).subscribe(() => {
      this.isVisible$.next(true);
    });
  }

  onSave = (location: LocationModel) => {
    this.locationService.add(location).then((savedLocation) => {
      if(savedLocation) {
        this.store.dispatch(new LocationSaved(savedLocation))
        notify({
          message: 'Location Added Successfully',
          position: 'top',
          width: 600,
          type: 'success'
        });
        this.onCancel();
      }
    })
  }

  onCancel() {
    this.location = null;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  ngOnDestroy() {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
