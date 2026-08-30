import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageLivePreviewComponent } from './page-live-preview.component';

/**
 * The framed public site, on its own so more than one screen can use it.
 *
 * It was declared inside PageManagerModule, which was fine while the page
 * stacks were its only caller. Navigation and Footer are top-level screens
 * with their own lazy modules now, and importing PageManagerModule to reach
 * one component would drag PageManagerRoutingModule in with it - registering
 * that module's routes a second time under whichever path did the importing.
 *
 * A component may only be declared once, so PageManagerModule imports this
 * rather than declaring it.
 */
@NgModule({
  declarations: [PageLivePreviewComponent],
  imports: [CommonModule],
  exports: [PageLivePreviewComponent]
})
export class PageLivePreviewModule { }
