import { Component, Input } from '@angular/core';

export interface ListHeaderAction {
  label: string;
  icon?: string;
  onClick: () => void;
}

/**
 * Replaces the dx-toolbar (page title + gear/kebab context-menu) pattern
 * that's repeated near-identically on ~20+ list screens. A single action
 * renders as a direct button rather than a one-item menu; more than one
 * renders as a kebab menu, matching what a menu is actually for.
 */
@Component({
    selector: 'app-list-header',
    templateUrl: './list-header.component.html',
    styleUrls: ['./list-header.component.scss'],
    standalone: false
})
export class ListHeaderComponent {
  @Input() title: string;
  @Input() actions: ListHeaderAction[] = [];
}
