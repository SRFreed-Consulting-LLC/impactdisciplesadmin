import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DockBarCta, DockBarModel } from '@impact-common/shared/models/domain/dock-bar.model';
import { DockBarService } from 'src/app/common/services/data/dock-bar.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import menuData from 'src/app/common/services/data/nav-menu-data';
import { SnackbarService } from '../../shared/snackbar.service';

interface Destination {
  text: string;
  value: string;
}

/** Marks a CTA as pointing somewhere this dropdown can't name, with the real
 *  address typed into the adjacent URL field. Same sentinel the home-page
 *  slide editor uses - see HomePageImageModel.ctaDestination. */
const EXTERNAL = 'external';

/**
 * Content Manager > Docking Bar - what the strip fixed to the bottom of every
 * page on the public site says, and where its buttons go. The renderer is the
 * web repo's LibraryDockComponent; this screen is the only thing that writes
 * what it shows.
 *
 * A singleton settings document (dock_bar/current), so this follows Web
 * Config's shape rather than a list screen's: one form, saved in place, no
 * add/delete and no grid.
 *
 * The destination dropdown is built from the same nav-menu-data.ts the slide
 * editor's own Button Destination field uses, so a page linkable from a home
 * slide is linkable from the bar and vice versa. Note that file is THIS app's
 * copy, used only to populate pickers - the public site's actual navigation
 * is a separate file in the web repo, so adding an entry here does not put a
 * page in the site menu.
 *
 * The second CTA is optional in the truest sense: leaving its title blank
 * means the bar renders one button. It is not a disabled second button, and
 * nothing is written for it.
 */
@Component({
  selector: 'app-docking-bar',
  templateUrl: './docking-bar.component.html',
  styleUrls: ['./docking-bar.component.css'],
  standalone: false
})
export class DockingBarComponent implements OnInit {
  form: FormGroup;
  spinnerVisible = true;
  itemType = 'Docking Bar';
  destinations: Destination[] = [];
  readonly externalValue = EXTERNAL;

  private readonly screenKey = 'content-manager.docking-bar';

  constructor(
    private service: DockBarService,
    private permissionService: PermissionService,
    private fb: FormBuilder,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      isActive: [false],
      label: [''],
      // The one field the bar cannot render without - an announcement with
      // no announcement is nothing. Everything else is genuinely optional.
      message: ['', Validators.required],
      note: [''],
      cta1: this.ctaGroup(true),
      cta2: this.ctaGroup(false)
    });

    menuData.forEach((menu) => {
      if (menu.link) {
        this.destinations.push({ text: menu.title, value: menu.link });
      }
      menu.dropdownItems?.forEach((item) => {
        this.destinations.push({ text: item.title, value: item.link });
      });
    });
    this.destinations.push({ text: 'External', value: EXTERNAL });
  }

  async ngOnInit(): Promise<void> {
    const config = await this.service.get();

    if (config) {
      this.form.patchValue({
        isActive: config.isActive ?? false,
        label: config.label ?? '',
        message: config.message ?? '',
        note: config.note ?? '',
        cta1: this.ctaValue(config.cta1),
        cta2: this.ctaValue(config.cta2)
      });
    }

    this.spinnerVisible = false;
  }

  canEdit(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  /** The buttons as the public dock would render them: in order, and the
   *  second one only once it has a title - the same rule hasSecondCta
   *  below encodes for saving. The LAST one is the solid button and any
   *  before it are ghosts, which is the real component's rule, so a single
   *  button always previews as the solid one. */
  get previewCtas(): { title: string }[] {
    const first = (this.form.get('cta1.title')?.value ?? '').trim();
    const second = (this.form.get('cta2.title')?.value ?? '').trim();
    return [
      ...(first ? [{ title: first }] : []),
      ...(second ? [{ title: second }] : [])
    ];
  }

  /** A second button exists only once it has been given a title. */
  get hasSecondCta(): boolean {
    return !!this.form.get('cta2.title')?.value?.trim();
  }

  async save(): Promise<void> {
    if (!this.canEdit()) {
      return;
    }

    // Surfaces the required-message error rather than saving a bar that
    // would render blank.
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.snackbar.error('Please give the bar a message before saving.');
      return;
    }

    this.spinnerVisible = true;
    try {
      await this.service.save(this.buildModel());
      this.snackbar.success('Docking Bar Saved Successfully!');
    } catch {
      this.snackbar.error('Could not save the Docking Bar. Please try again.');
    } finally {
      this.spinnerVisible = false;
    }
  }

  /** Optional text fields are OMITTED when blank rather than written as an
   *  empty string, so the renderer's `@if (label)` checks mean "staff left
   *  this out" instead of having to also test for ''. */
  private buildModel(): DockBarModel {
    const value = this.form.value;
    return {
      isActive: !!value.isActive,
      message: (value.message ?? '').trim(),
      ...(value.label?.trim() ? { label: value.label.trim() } : {}),
      ...(value.note?.trim() ? { note: value.note.trim() } : {}),
      cta1: this.buildCta(value.cta1)!,
      ...(this.hasSecondCta ? { cta2: this.buildCta(value.cta2)! } : {})
    } as DockBarModel;
  }

  private buildCta(value: { title?: string; destination?: string; url?: string }): DockBarCta | undefined {
    const title = (value?.title ?? '').trim();
    if (!title) {
      return undefined;
    }
    const destination = value.destination ?? '';
    return {
      title,
      destination,
      // Only meaningful alongside the 'external' sentinel; carrying a stale
      // URL on an internal destination would be a trap for the next editor.
      ...(destination === EXTERNAL && value.url?.trim() ? { url: value.url.trim() } : {})
    };
  }

  private ctaGroup(required: boolean): FormGroup {
    return this.fb.group({
      title: ['', required ? [Validators.required] : []],
      destination: [''],
      url: ['']
    });
  }

  private ctaValue(cta: DockBarCta | undefined): { title: string; destination: string; url: string } {
    return {
      title: cta?.title ?? '',
      destination: cta?.destination ?? '',
      url: cta?.url ?? ''
    };
  }
}
