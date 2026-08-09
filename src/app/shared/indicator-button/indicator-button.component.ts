import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-indicator-button',
    templateUrl: './indicator-button.component.html',
    styleUrls: ['./indicator-button.component.scss'],
    standalone: false
})
export class IndicatorButtonComponent {
  @Input() public cssClass?: string;
  @Input() public disabled: boolean;
  @Input() public isInProgress: boolean;
  @Input() public title = 'SAVE';
  @Input() public stylingMode: 'text' | 'outlined' | 'contained' = 'contained';
  @Input() public height: string;
  @Input() public width: string;
  @Input() public hint: string;

  // Name kept as-is (rather than the Angular-idiomatic `click`) so every
  // existing `(onClick)="..."` call site keeps working unchanged - this
  // component's whole point is being a drop-in replacement.
  @Output() public onClick = new EventEmitter<void>();

  handleClick(): void {
    if (!this.isInProgress && !this.disabled) {
      this.onClick.emit();
    }
  }
}
