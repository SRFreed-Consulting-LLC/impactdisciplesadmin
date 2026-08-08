import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { EventModel } from 'impactdisciplescommon/src/models/domain/event.model';
import { EventService } from 'impactdisciplescommon/src/services/data/event.service';
import { OrganizationModel } from 'impactdisciplescommon/src/models/domain/organization.model';
import { OrganizationService } from 'impactdisciplescommon/src/services/data/organization.service';
import { LocationModel } from 'impactdisciplescommon/src/models/domain/location.model';
import { LocationService } from 'impactdisciplescommon/src/services/data/location.service';
import { EMailTemplatesService } from 'impactdisciplescommon/src/services/data/email-templates.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { ImageModel } from 'impactdisciplescommon/src/models/utils/image.model';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { LocationsComponent } from '../locations/locations.component';
import { OrganizationsComponent } from '../organizations/organizations.component';

// Full-page in-place edit view (mode: 'list' | 'edit', no popup - see
// products.component.ts (store-manager) for the established precedent) -
// the densest form in the app, now also hosting a calendar (Agenda tab).
@Component({
    selector: 'app-events',
    templateUrl: './events.component.html',
    styleUrls: ['./events.component.scss'],
    standalone: false
})
export class EventsComponent implements OnInit {
  mode: 'list' | 'edit' = 'list';

  // ---- List state ----
  events$: Observable<EventModel[]>;
  displayedColumns = ['isActive', 'startDate', 'endDate', 'costInDollars', 'isSummit', 'eventName', 'organization', 'location', 'actions'];
  filterColumns = ['isActive-filter', 'startDate-filter', 'endDate-filter', 'costInDollars-filter', 'isSummit-filter', 'eventName-filter', 'organization-filter', 'location-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;
  numberOperators = NUMBER_FILTER_OPERATORS;

  itemType = 'Event';

  // Was read fresh via authService.getLoggedInUser().role on every
  // isVisible() call - see events-manager's other migrated screens for the
  // full explanation.
  currentUserRole?: string;

  actions: ListHeaderAction[] = [];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Kept live for the whole component lifetime - serves the list's
  // Organization/Location name lookups AND the edit form's own selects, so
  // adding one via "Manage Locations"/"Manage Organizations" while editing
  // shows up in the select immediately. Same pattern as Products'
  // categories/series arrays.
  organizations: OrganizationModel[] = [];
  locations: LocationModel[] = [];
  emailTemplates: string[] = [];

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  // ---- Edit state ----
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit = false;

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs app-image-uploader's [card]/[field] inputs directly - see
  // home-page-image-dialog.component.ts (web-manager) for the established
  // explanation of this pattern.
  card: { imageUrl?: ImageModel } = {};

  // The live EventModel instance itself - not just a form value. Agenda/
  // Attendees/Break Outs/Application all take this object directly and
  // mutate fields on it in place (agendaItems, diningOptions, faqList,
  // etc.), exactly like the original's [(formData)]="selectedItem"
  // two-way binding did for the whole object. The Info tab's own fields
  // live in `form` instead and get merged back on top of this object at
  // Save time - the two field sets never overlap.
  editingItem: EventModel | null = null;

  constructor(
    private service: EventService,
    private organizationService: OrganizationService,
    private locationService: LocationService,
    private emailTemplateService: EMailTemplatesService,
    private authService: AdminAuthService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.authService.dao.loggedInUser$.subscribe((user) => {
      this.currentUserRole = user?.role;
      this.actions = this.isVisible(['Admin']) ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : [];
    });

    this.organizationService.streamAll().subscribe((organizations) => {
      this.organizations = organizations;
    });
    this.locationService.streamAll().subscribe((locations) => {
      this.locations = locations;
    });
    this.emailTemplateService.getAll().then((templates) => {
      this.emailTemplates = templates.map((t) => t.name);
    });

    this.events$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) => Object.keys(filters).every((field) => this.matchesField(item, field, filters[field])))
          .sort((a, b) => this.toMillis(b.startDate) - this.toMillis(a.startDate))
      ),
      tap(() => this.loading$.next(false))
    );
  }

  isVisible(roles: string[]): boolean {
    return roles.some((role) => role === this.currentUserRole);
  }

  organizationName(item: EventModel): string {
    const id = typeof item.organization === 'string' ? item.organization : item.organization?.id;
    return this.organizations.find((o) => o.id === id)?.name ?? '';
  }

  locationName(item: EventModel): string {
    const id = typeof item.location === 'string' ? item.location : item.location?.id;
    return this.locations.find((l) => l.id === id)?.name ?? '';
  }

  private matchesField(item: EventModel, field: string, filter: ColumnFilterValue): boolean {
    if (field === 'organization') {
      return matchesColumnFilter(this.organizationName(item), filter, 'text');
    }
    if (field === 'location') {
      return matchesColumnFilter(this.locationName(item), filter, 'text');
    }
    if (field === 'costInDollars') {
      return matchesColumnFilter(item.costInDollars, filter, 'number');
    }
    if (field === 'startDate' || field === 'endDate') {
      return matchesColumnFilter(this.toMillis((item as any)[field]), filter, 'date');
    }
    return matchesColumnFilter((item as any)[field], filter, 'text');
  }

  private toMillis(value: any): number {
    if (!value) return 0;
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  delete(item: EventModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }

  manageLocations(): void {
    this.dialog.open(LocationsComponent, { width: '1000px', maxWidth: '95vw' });
  }

  manageOrganizations(): void {
    this.dialog.open(OrganizationsComponent, { width: '900px', maxWidth: '95vw' });
  }

  // ---- Edit view ----

  showAddModal(): void {
    this.editingItem = { ...new EventModel() };
    this.isEdit = false;
    this.card = {};
    this.buildForm(this.editingItem);
    this.mode = 'edit';
  }

  showEditModal(item: EventModel): void {
    this.editingItem = { ...item };
    this.isEdit = true;
    this.card = { imageUrl: item.imageUrl };
    this.buildForm(this.editingItem);
    this.mode = 'edit';
  }

  private buildForm(item: EventModel): void {
    const locationId = typeof item.location === 'string' ? item.location : (item.location as LocationModel)?.id ?? null;
    const organizationId = typeof item.organization === 'string' ? item.organization : (item.organization as OrganizationModel)?.id ?? null;

    this.form = this.fb.group({
      isActive: [item.isActive ?? false],
      eventName: [item.eventName ?? '', Validators.required],
      emailTemplate: [item.emailTemplate ?? null],
      startDate: [this.toInputValue(item.startDate), Validators.required],
      endDate: [this.toInputValue(item.endDate)],
      checkIn: [this.toTimeValue(item.checkIn)],
      costInDollars: [item.costInDollars ?? 0],
      isSummit: [item.isSummit ?? false],
      videoId: [item.videoId ?? ''],
      isOnline: [item.isOnline ?? false],
      isKajabiCourse: [item.isKajabiCourse ?? false],
      kajabiPurchaseURL: [item.kajabiPurchaseURL ?? ''],
      kajabiSubscribeURL: [item.kajabiSubscribeURL ?? ''],
      location: [locationId],
      organization: [organizationId],
      description: [item.description ?? '']
    });

    this.updateConditionalValidators();
    this.form.get('isOnline')?.valueChanges.subscribe(() => this.updateConditionalValidators());
  }

  // Mirrors the original's conditional [isRequired] bindings exactly,
  // including the (slightly unusual, but intentional - not a bug flagged
  // for fixing) rule that the Kajabi URLs are only actually *required*
  // when isOnline is true, not merely when isKajabiCourse is checked.
  private updateConditionalValidators(): void {
    const isOnline = this.form.get('isOnline')?.value;

    const toggle = (field: string, required: boolean) => {
      const control = this.form.get(field);
      control?.setValidators(required ? [Validators.required] : []);
      control?.updateValueAndValidity({ emitEvent: false });
    };

    toggle('emailTemplate', !isOnline);
    toggle('endDate', !isOnline);
    toggle('checkIn', !isOnline);
    toggle('location', !isOnline);
    toggle('kajabiPurchaseURL', isOnline);
    toggle('kajabiSubscribeURL', isOnline);
  }

  private toInputValue(date: any): string {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private toTimeValue(date: any): string {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  showImageUploader(): void {
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    this.isImageUploaderVisible$.next(false);
  }

  onCancel(): void {
    this.inProgress$.next(false);
    this.mode = 'list';
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const raw = this.form.getRawValue();
    const value: EventModel = {
      ...this.editingItem,
      ...raw,
      startDate: raw.startDate ? new Date(raw.startDate) : this.editingItem?.startDate,
      endDate: raw.endDate ? new Date(raw.endDate) : this.editingItem?.endDate,
      imageUrl: this.card.imageUrl
    };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.mode = 'list';
        this.inProgress$.next(false);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
