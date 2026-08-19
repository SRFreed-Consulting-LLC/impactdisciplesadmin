import { Component, EventEmitter, Input, OnDestroy, Output, forwardRef } from '@angular/core';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

// One picker-driven date+time control for every admin form that used to
// ask for typed digits in a native datetime-local input (user request,
// 2026-08-19): a Material CALENDAR for the date and a Material TIME
// DROPDOWN (15-minute suggestions, still free-typeable) for the time.
//
// Drop-in by design: the ControlValueAccessor reads and writes the SAME
// "YYYY-MM-DDTHH:mm" string a datetime-local input produces, so the 14
// call sites (campaign wizard/email schedule/popup window, event
// start/end, agenda items, breakout blocks, attendee registration)
// swapped markup only - none of their patch/save conversions changed.
@Component({
    selector: 'app-date-time-field',
    templateUrl: './date-time-field.component.html',
    styleUrls: ['./date-time-field.component.scss'],
    standalone: false,
    providers: [{
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DateTimeFieldComponent),
      multi: true
    }]
})
export class DateTimeFieldComponent implements ControlValueAccessor, OnDestroy {
  @Input() label = 'Date';
  @Input() required = false;
  /** Emitted alongside the CVA propagation for template-driven listeners. */
  @Output() changed = new EventEmitter<string | null>();

  dateControl = new FormControl<Date | null>(null);
  timeControl = new FormControl<Date | null>(null);

  private onChange: (value: string | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  private suppress = false;
  private ngUnsubscribe = new Subject<void>();

  constructor() {
    this.dateControl.valueChanges.pipe(takeUntil(this.ngUnsubscribe)).subscribe(() => this.propagate());
    this.timeControl.valueChanges.pipe(takeUntil(this.ngUnsubscribe)).subscribe(() => this.propagate());
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  writeValue(value: string | Date | null): void {
    this.suppress = true;
    const date = this.parse(value);
    this.dateControl.setValue(date, { emitEvent: false });
    this.timeControl.setValue(date, { emitEvent: false });
    this.suppress = false;
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    if (disabled) {
      this.dateControl.disable({ emitEvent: false });
      this.timeControl.disable({ emitEvent: false });
    } else {
      this.dateControl.enable({ emitEvent: false });
      this.timeControl.enable({ emitEvent: false });
    }
  }

  onBlur(): void {
    this.onTouched();
  }

  private parse(value: string | Date | null): Date | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  // Combined value: the picked calendar day + the picked time (midnight
  // when no time chosen yet) as a datetime-local string.
  private propagate(): void {
    if (this.suppress) {
      return;
    }
    const date = this.dateControl.value;
    if (!date) {
      this.onChange(null);
      this.changed.emit(null);
      return;
    }
    const time = this.timeControl.value;
    const pad = (n: number) => String(n).padStart(2, '0');
    const value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(time?.getHours() ?? 0)}:${pad(time?.getMinutes() ?? 0)}`;
    this.onChange(value);
    this.changed.emit(value);
  }
}
