import { Component, OnInit } from '@angular/core';
import { Observable, map } from 'rxjs';
import { HomePageImageModel } from '@impact-common/shared/models/domain/home-page-image.model';
import { HomePageImageService } from 'src/app/common/services/data/home-page-images.service';
import { PreviewDevice } from './home-live-preview.component';

/**
 * HOME - every section the public home page renders, on one screen, in the
 * order a visitor meets them, with a live preview beside them.
 *
 * Replaces the standalone 'Home Page Images' screen (2026-08-29). It is a
 * SECTION STACK rather than a renamed list because the slider is only the
 * first of several home-page sections: the services strip and testimonials
 * are expected to move here, and a stack absorbs those by appending rather
 * than by being redesigned.
 *
 * NOT here, deliberately: the docking bar. It looks like home-page content
 * because that is where staff notice it, but the web app mounts it in
 * app.component.html and it renders on EVERY page - it is site furniture, so
 * it lives with the rest of the site-wide settings on Web Config. The
 * pointer at the foot of this screen exists so nobody hunts for it here.
 */
@Component({
  selector: 'app-page-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  standalone: false
})
export class HomeComponent implements OnInit {
  /** Sections that will move onto this screen but have not yet. Rendered as
   *  placeholders so the screen reads as "the home page", not "the slider" -
   *  and so the next person can see where their section is meant to go. */
  readonly plannedSections: readonly string[] = ['Services strip', 'Testimonials'];

  device: PreviewDevice = 'desktop';

  /**
   * What the PUBLIC slider would show: active slides only, in order.
   *
   * Read here rather than handed up from the grid section. The grid streams
   * every slide because staff edit the switched-off ones too; the preview
   * wants exactly what a visitor gets, and deriving that from its own stream
   * keeps the two from having to know about each other. Both read the same
   * live collection, so a save updates both.
   */
  liveSlides$!: Observable<HomePageImageModel[]>;

  constructor(private service: HomePageImageService) {}

  ngOnInit(): void {
    this.liveSlides$ = this.service.streamAll().pipe(
      map((slides) => slides
        .filter((slide) => slide.isActive)
        // Same sort as the web slider. Slides sharing an order number come
        // back in whatever sequence the stream gave them - which is the
        // point of the clash warning on the grid: this preview cannot show a
        // running order that the data does not actually determine.
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
    );
  }

  setDevice(device: PreviewDevice): void {
    this.device = device;
  }
}
