import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { WebConfigModel } from 'src/app/common/models/utils/web-config.model';
import { WebConfigService } from 'src/app/common/services/data/web-config.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';

// A singleton settings document, not a list - the original had no popup and
// no add/delete, just one dx-form saved in place. Every tab (Info, Privacy
// Policy, Terms of Use) has its own SAVE button calling the same save(),
// matching the original exactly.
@Component({
    selector: 'app-web-config',
    templateUrl: './web-config.component.html',
    styleUrls: ['./web-config.component.css'],
    standalone: false
})
export class WebConfigComponent implements OnInit {
  form: FormGroup;
  spinnerVisible = true;
  richTextModules = RICH_TEXT_TOOLBAR;

  itemType = 'Web Configuration';

  private readonly screenKey = 'tools-manager.web-config';

  private selectedItem: WebConfigModel;

  constructor(
    private service: WebConfigService,
    private permissionService: PermissionService,
    private fb: FormBuilder,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      twitter: [''],
      facebook: [''],
      facebookLive: [''],
      applePodCast: [''],
      linkedIn: [''],
      youtube: [''],
      instagram: [''],
      inpersonSeminarCost: [null],
      onlineSeminarCost: [null],
      equippingGroupTotalCost: [null],
      equippingGroupPaymentCost: [null],
      freeShippingAmount: [null],
      adminEmailAddress: [''],
      email: [''],
      phone: [''],
      address: this.fb.group({
        address1: [''],
        address2: [''],
        city: [''],
        state: [''],
        zip: ['']
      }),
      policy: [''],
      tos: ['']
    });
  }

  async ngOnInit(): Promise<void> {
    const config = await this.service.getAll();
    this.selectedItem = config && config.length === 1 ? config[0] : { ...new WebConfigModel() };

    this.form.patchValue({
      ...this.selectedItem,
      address: this.selectedItem.address ?? {}
    });

    this.spinnerVisible = false;
  }

  canEdit(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  async save(): Promise<void> {
    if (!this.canEdit()) {
      return;
    }
    this.spinnerVisible = true;
    const value: WebConfigModel = { ...this.selectedItem, ...this.form.value };

    this.selectedItem = this.selectedItem.id
      ? await this.service.update(this.selectedItem.id, value)
      : await this.service.add(value);

    this.snackbar.success('Configuration Saved Successfully!');
    this.spinnerVisible = false;
  }
}
