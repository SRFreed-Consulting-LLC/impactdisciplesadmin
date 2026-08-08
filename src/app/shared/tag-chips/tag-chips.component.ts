import { Component, EventEmitter, forwardRef, Input, Output } from '@angular/core';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR } from '@angular/forms';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { MatChipInputEvent } from '@angular/material/chips';
import { MatAutocompleteSelectedEvent, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { map, Observable, startWith } from 'rxjs';
import { TagModel } from 'impactdisciplescommon/src/models/domain/tag.model';

// Material replacement for DevExtreme's dx-tag-box with acceptCustomValue +
// onCustomItemCreating (used today by Pod Casts' "Tags" field): a chip list
// backed by an autocomplete over `options`. Typing a name that doesn't match
// any existing option and pressing Enter/comma asks the parent to create it
// (createTag) rather than creating it here - the parent owns persistence
// (e.g. PodCastTagsService), this component only owns selection/display,
// the same division of responsibility as PhoneFieldComponent /
// AddressFieldComponent (a plain @Input() group, no business logic).
@Component({
    selector: 'app-tag-chips',
    templateUrl: './tag-chips.component.html',
    styleUrls: ['./tag-chips.component.scss'],
    standalone: false,
    providers: [
      {
        provide: NG_VALUE_ACCESSOR,
        useExisting: forwardRef(() => TagChipsComponent),
        multi: true
      }
    ]
})
export class TagChipsComponent implements ControlValueAccessor {
  @Input() options: TagModel[] = [];
  @Input() placeholder = 'Add a tag...';
  @Output() createTag = new EventEmitter<string>();

  readonly separatorKeyCodes = [ENTER, COMMA];

  value: TagModel[] = [];
  inputControl = new FormControl('');
  filteredOptions$: Observable<TagModel[]>;
  disabled = false;

  private onChange: (value: TagModel[]) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    this.filteredOptions$ = this.inputControl.valueChanges.pipe(
      startWith(''),
      map((term) => this.filterOptions(typeof term === 'string' ? term : ''))
    );
  }

  writeValue(value: TagModel[] | null): void {
    this.value = value ?? [];
  }

  registerOnChange(fn: (value: TagModel[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  selectOption(event: MatAutocompleteSelectedEvent, input: HTMLInputElement): void {
    this.addTag(event.option.value as TagModel);
    input.value = '';
    this.inputControl.setValue('');
  }

  commitTyped(event: MatChipInputEvent, trigger?: MatAutocompleteTrigger): void {
    const text = (event.value ?? '').trim();
    if (!text) {
      return;
    }

    const existing = this.options.find((option) => (option.tag ?? '').toLowerCase() === text.toLowerCase());
    if (existing) {
      this.addTag(existing);
    } else {
      this.createTag.emit(text);
    }

    event.chipInput?.clear();
    this.inputControl.setValue('');
    // Without this, the panel reopens showing the full (now unfiltered)
    // options list the instant the term resets to '' - looked like a
    // rendering bug (a stray, seemingly-random option appearing) rather
    // than what it actually is: every remaining tag matching an empty
    // search term.
    trigger?.closePanel();
  }

  removeTag(tag: TagModel): void {
    this.value = this.value.filter((t) => t !== tag);
    this.onChange(this.value);
    this.onTouched();
  }

  private filterOptions(term: string): TagModel[] {
    const text = term.toLowerCase();
    const selected = new Set(this.value.map((tag) => tag.id));
    return this.options.filter((option) => !selected.has(option.id) && (option.tag ?? '').toLowerCase().includes(text));
  }

  private addTag(tag: TagModel): void {
    this.value = [...this.value, tag];
    this.onChange(this.value);
    this.onTouched();
  }
}
