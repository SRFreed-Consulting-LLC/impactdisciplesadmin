import { booleanAttribute, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-indicator-button',
    templateUrl: './indicator-button.component.html',
    styleUrls: ['./indicator-button.component.scss'],
    standalone: false
})
export class IndicatorButtonComponent {
  @Input() public cssClass?: string;
  // booleanAttribute on both: ~30 templates bind these to an async-piped
  // inProgress$ subject, which is `boolean | null` before its first emission.
  // Coercing at this boundary is what let strictNullChecks go on (2026-09-05)
  // without a `?? false` in every one of them.
  @Input({ transform: booleanAttribute }) public disabled = false;
  @Input({ transform: booleanAttribute }) public isInProgress = false;
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
