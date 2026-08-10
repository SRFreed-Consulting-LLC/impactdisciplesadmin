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

  // Was `onClick` - renamed to satisfy @angular-eslint/no-output-on-prefix
  // (Angular's own style guide: outputs shouldn't be named "on"/prefixed
  // with it, since the template binding syntax `(clicked)="..."` already
  // reads as an event without repeating "on"). All call sites' `(onClick)`
  // bindings were updated to `(clicked)` in the same pass - see git history
  // if you're looking for the old name.
  @Output() public clicked = new EventEmitter<void>();

  handleClick(): void {
    if (!this.isInProgress && !this.disabled) {
      this.clicked.emit();
    }
  }
}
