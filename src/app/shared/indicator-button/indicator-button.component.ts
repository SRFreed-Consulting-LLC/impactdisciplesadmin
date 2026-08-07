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

  @Output() public onClick: EventEmitter<void> = new EventEmitter();
}
