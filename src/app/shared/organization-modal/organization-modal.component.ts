import { Component, Input, OnInit } from '@angular/core';
import { Actions, ofActionSuccessful, Store } from '@ngxs/store';
import { BehaviorSubject, Observable, Subject, takeUntil } from 'rxjs';
import notify from 'devextreme/ui/notify';
import { PHONE_TYPES } from 'impactdisciplescommon/src/lists/phone_types.enum';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { OrganizationModel } from 'impactdisciplescommon/src/models/domain/organization.model';
import { OrganizationSaved, ShowOrganizationModal } from './organization-modal.actions';
import { OrganizationService } from 'impactdisciplescommon/src/services/data/organization.service';

@Component({
    selector: 'app-organization-modal',
    templateUrl: './organization-modal.component.html',
    styleUrls: ['./organization-modal.component.scss'],
    standalone: false
})
export class OrganizationModalComponent implements OnInit {
  phone_types: PHONE_TYPES[];
  public organization: OrganizationModel;
  phoneEditorOptions = {
    mask: '(X00) 000-0000',
    maskRules: {
      X: /[02-9]/,
    },
    maskInvalidMessage: 'The phone must have a correct USA phone format',
    valueChangeEvent: 'keyup',
  };

  public inProgress$ = new BehaviorSubject<boolean>(false);
  public isVisible$ = new BehaviorSubject<boolean>(false);

  private ngUnsubscribe = new Subject<void>();

  constructor(private actions$: Actions, private store: Store, private organizationService: OrganizationService){}

  ngOnInit(): void {
    this.phone_types = EnumHelper.getPhoneTypesAsArray();
    this.actions$.pipe(ofActionSuccessful(ShowOrganizationModal), takeUntil(this.ngUnsubscribe)).subscribe(() => {
      this.isVisible$.next(true);
    });
  }

  onSave = (organization: OrganizationModel) => {
    this.organizationService.add(organization).then((savedOrganization) => {
      if(savedOrganization) {
        this.store.dispatch(new OrganizationSaved(savedOrganization))
        notify({
          message: 'Organization Added Successfully',
          position: 'top',
          width: 600,
          type: 'success'
        });
        this.onCancel();
      }
    })
  }

  onCancel() {
    this.organization = null;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  ngOnDestroy() {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
