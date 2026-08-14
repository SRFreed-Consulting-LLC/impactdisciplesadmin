import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MailchimpConfigModel } from 'src/app/common/models/utils/mailchimp-config.model';
import { MailchimpConfigService } from 'src/app/common/services/data/mailchimp-config.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { SnackbarService } from '../../shared/snackbar.service';

// Singleton settings document, same shape as web-config.component.ts (one
// form, no popup, no add/delete) - just for the Mailchimp sync in
// functions/src/mailchimp-sync.functions.ts, which reads this same doc
// (integration_settings/mailchimp) live on every customer create/update.
// Deliberately has no field for the Mailchimp API key itself - see
// MailchimpConfigModel's own comment on why (firestore.rules is wide open).
@Component({
    selector: 'app-mailchimp-settings',
    templateUrl: './mailchimp-settings.component.html',
    styleUrls: ['./mailchimp-settings.component.css'],
    standalone: false
})
export class MailchimpSettingsComponent implements OnInit {
  form: FormGroup;
  spinnerVisible = true;

  itemType = 'Mailchimp Settings';

  private readonly screenKey = 'tools-manager.mailchimp';

  private selectedItem: MailchimpConfigModel;

  constructor(
    private service: MailchimpConfigService,
    private permissionService: PermissionService,
    private fb: FormBuilder,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      enabled: [false],
      audienceId: [''],
      serverPrefix: [''],
      defaultSubscribeStatus: ['pending'],
      enableSourceTags: [true],
      purchaseTag: ['Store Customer'],
      eventRegistrationTag: ['Event Registrant']
    });

    // Audience ID only needs to be filled in once the integration is
    // actually turned on - toggling Enabled on/off adds/removes the
    // required validator rather than always requiring it, so the form isn't
    // pre-blocked on a field that doesn't matter while disabled.
    this.form.get('enabled')?.valueChanges.subscribe((enabled: boolean) => {
      const audienceId = this.form.get('audienceId');
      audienceId?.setValidators(enabled ? [Validators.required] : []);
      audienceId?.updateValueAndValidity();
    });
  }

  async ngOnInit(): Promise<void> {
    const config = await this.service.getConfig();
    this.selectedItem = config ?? { ...new MailchimpConfigModel() };

    this.form.patchValue({
      enabled: this.selectedItem.enabled ?? false,
      audienceId: this.selectedItem.audienceId ?? '',
      serverPrefix: this.selectedItem.serverPrefix ?? '',
      defaultSubscribeStatus: this.selectedItem.defaultSubscribeStatus ?? 'pending',
      enableSourceTags: this.selectedItem.enableSourceTags ?? true,
      purchaseTag: this.selectedItem.purchaseTag ?? 'Store Customer',
      eventRegistrationTag: this.selectedItem.eventRegistrationTag ?? 'Event Registrant'
    });

    this.spinnerVisible = false;
  }

  canEdit(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  async save(): Promise<void> {
    if (!this.canEdit() || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.spinnerVisible = true;
    const value: MailchimpConfigModel = { ...this.selectedItem, ...this.form.value };

    this.selectedItem = await this.service.saveConfig(value);

    this.snackbar.success('Mailchimp Settings Saved Successfully!');
    this.spinnerVisible = false;
  }
}
