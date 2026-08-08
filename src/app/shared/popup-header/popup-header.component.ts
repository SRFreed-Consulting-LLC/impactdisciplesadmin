import { Component, EventEmitter, Input, Output } from '@angular/core';

// Standard title bar for Material dialogs across the app - the Material
// equivalent of dx-popup's [showTitle]/[showCloseButton] toolbar. Every
// migrated popup should use this instead of a bare <h2 mat-dialog-title>,
// so all dialogs get the same header behavior and look for free:
//   <app-popup-header [title]="'...'" [showCloseButton]="true" (closed)="onClose()">
//     <button ... popup-header-actions>...</button>  <!-- optional, e.g. "New" -->
//   </app-popup-header>
// The host component still owns closing itself (inject MatDialogRef and
// implement `onClose(): void { this.dialogRef.close(); }`) since each
// dialog is its own MatDialog.open()-ed component - this only standardizes
// the chrome, not the dialog lifecycle.
@Component({
    selector: 'app-popup-header',
    templateUrl: './popup-header.component.html',
    styleUrls: ['./popup-header.component.scss'],
    standalone: false
})
export class PopupHeaderComponent {
  @Input() title: string;
  @Input() showCloseButton = true;
  @Output() closed = new EventEmitter<void>();
}
