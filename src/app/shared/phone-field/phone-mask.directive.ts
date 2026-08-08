import { Directive, ElementRef, HostListener } from '@angular/core';
import { NgControl } from '@angular/forms';

// Formats a US phone number as the admin types: (555) 123-4567. The
// original used a DevExtreme mask ('(X00) 000-0000') that also rejected an
// invalid leading area-code digit (0/1) as you typed; this only reformats
// digits progressively and doesn't reject characters, since the mask was
// purely a data-entry convenience here (no validator was ever tied to it).
@Directive({
    selector: '[appPhoneMask]',
    standalone: false
})
export class PhoneMaskDirective {
  constructor(private el: ElementRef<HTMLInputElement>, private control: NgControl) {}

  @HostListener('input')
  onInput(): void {
    const digits = (this.el.nativeElement.value ?? '').replace(/\D/g, '').slice(0, 10);
    let formatted = digits;

    if (digits.length > 6) {
      formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    } else if (digits.length > 3) {
      formatted = `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    } else if (digits.length > 0) {
      formatted = `(${digits}`;
    }

    this.control.control?.setValue(formatted, { emitEvent: false });
    this.el.nativeElement.value = formatted;
  }
}
