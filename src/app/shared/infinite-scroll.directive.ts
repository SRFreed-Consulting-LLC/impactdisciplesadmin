import { Directive, ElementRef, EventEmitter, HostListener, Output } from '@angular/core';

// Sits on the same scrolling element as a paginated table's .table-scroll
// div. Fires scrolledToBottom as the admin nears the end of what's loaded
// so far, so the caller can kick off PagedCollectionSource.loadNextPage()
// before they actually hit the bottom (no visible pause/jump).
@Directive({
    selector: '[appInfiniteScroll]',
    standalone: false
})
export class InfiniteScrollDirective {
  @Output() scrolledToBottom = new EventEmitter<void>();

  // How far (px) from the true bottom to fire early.
  private static readonly THRESHOLD_PX = 300;

  constructor(private el: ElementRef<HTMLElement>) {}

  @HostListener('scroll')
  onScroll(): void {
    const element = this.el.nativeElement;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;

    if (distanceFromBottom < InfiniteScrollDirective.THRESHOLD_PX) {
      this.scrolledToBottom.emit();
    }
  }
}
