import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, signal } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';
import { LibraryUser } from 'src/app/common/models/domain/library/library-user.model';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import { ensureLibraryVendorStylesheet } from 'src/app/common/services/data/library/library-vendor-stylesheet.util';

/** Derived, geolocated subset of `libraryUsers` (each user's IP-derived
 *  location, written by the reader app's login flow) - see
 *  LibraryUserService.getLibraryUsers(). */
interface UserLocation {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  lat: number;
  lng: number;
  city?: string;
  region?: string;
  country?: string;
}

/** CARTO Basemaps key. Since 2026 CARTO stamps "API KEY REQUIRED" across
 *  every tile served without one (Shane saw the map covered in it on
 *  2026-09-04). Free tier, 5M tiles/month, registered to the admin domains
 *  and locked to them, so it is a public key like the Firebase apiKeys in
 *  the shared config - fine to ship in the bundle. Regenerate at
 *  carto.com/basemaps/apikey. */
const CARTO_BASEMAPS_KEY = 'cb1_2wr3_1_c3522e86bdefd6fe319914bf';
const COUNTRY_BORDERS_URL = 'assets/world-countries.geo.json';
const COUNTRY_BORDER_COLOR = '#2f7dff';

/** How long a marker stays "glowing" after being added or moved, before
 *  fading back to its normal steady pulse - see glow(). */
const GLOW_DURATION_MS = 5000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markerIcon(): L.DivIcon {
  return L.divIcon({
    className: 'map-marker',
    html: '<span class="map-marker-pulse"></span><span class="map-marker-dot"></span>',
    iconSize: [16, 16],
  });
}

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/world-map/world-map.component.ts. World map of where library
 * users are using the reader app (from IP-derived locations - see
 * LibraryUserService). Adapted to this app's tab-shell convention (a plain
 * inline NavLeaf tab filling `.manager-content`, not a MatDialog the source
 * app auto-opened/reopened over the treeview) - matches the consolidation
 * plan's own "World Map becomes a real menu item" decision.
 *
 * **Deliberate scope cut**: the source component also had an elaborate
 * "Matrix" color-theme treatment (a smaller framed map, green markers, a
 * bright glow, and an animated digital-rain overlay of lesson memory-verse
 * references) gated on that source app's own ThemeService.activeColorTheme()
 * === 'matrix'. This app's own theme catalog (`_theme-variants.scss`) is a
 * completely separate 10-variant navy set with no 'matrix' id at all - that
 * whole branch could never trigger here, so it (and its MemoryVerseService
 * dependency, which also has no equivalent ported into this app) was
 * dropped rather than carried over as permanently-dead code. Every user
 * here gets what the source app called its "every other theme" treatment:
 * a full-bleed dark basemap, a blue country-borders overlay, and markers/
 * header colors that follow the active Color Theme's own
 * --mat-sys-primary/--mat-sys-tertiary, same as every other themed element
 * in the app.
 */
@Component({
  selector: 'app-world-map',
  standalone: true,
  imports: [MatProgressSpinnerModule],
  templateUrl: './world-map.component.html',
  styleUrl: './world-map.component.scss',
})
export class WorldMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true })
  private readonly mapContainer!: ElementRef<HTMLDivElement>;

  readonly loading = signal(true);
  readonly userCount = signal(0);

  private map: L.Map | undefined;
  private locationsSubscription: Subscription | undefined;
  private countryBordersData: GeoJSON.FeatureCollection | undefined;

  private readonly markersById = new Map<string, L.Marker>();
  private readonly locationsById = new Map<string, UserLocation>();
  /** False only for the map's very first population - a fresh page load
   *  isn't "users just showing up", so nothing glows until a location is
   *  genuinely added/moved *after* that initial snapshot. */
  private hasLoadedOnce = false;

  constructor(private userLocations: LibraryUserService) {
    ensureLibraryVendorStylesheet('leaflet.css');
  }

  ngAfterViewInit(): void {
    this.map = L.map(this.mapContainer.nativeElement, {
      center: [20, 0],
      zoom: 2,
      minZoom: 1,
      worldCopyJump: true,
    });
    // Dark basemap regardless of theme/light-dark mode. `dark_nolabels`
    // rather than `dark_all`: the labeled variant renders each
    // country/city name in ITS OWN local language rather than a
    // consistent one - a jarring, inconsistent mix of scripts across the
    // same map. Country shapes plus the blue borders overlay are enough to
    // orient by without needing place-name labels at all.
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png?key=${CARTO_BASEMAPS_KEY}`, {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(this.map);

    void this.addCountryBordersLayer();

    this.locationsSubscription = this.userLocations.getLibraryUsers().subscribe((users) => {
      const locations = users
        .filter((u): u is LibraryUser & { location: NonNullable<LibraryUser['location']> } => !!u.location)
        .map((u) => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          lat: u.location.lat,
          lng: u.location.lng,
          city: u.location.city,
          region: u.location.region,
          country: u.location.country,
        }));
      this.plot(locations);
      this.userCount.set(locations.length);
      this.loading.set(false);
    });
  }

  /** Reconciles the currently-plotted markers against a fresh emission from
   *  LibraryUserService's live Firestore listener - added/moved/removed,
   *  rather than tearing down and recreating every marker on every
   *  emission, so an unchanged user's marker never flickers and a
   *  genuinely new or moved one can be told apart to glow() - see
   *  hasLoadedOnce's doc comment for why the very first emission never
   *  glows. */
  private plot(locations: UserLocation[]): void {
    if (!this.map) {
      return;
    }
    const seenIds = new Set<string>();

    for (const location of locations) {
      seenIds.add(location.id);
      const previous = this.locationsById.get(location.id);
      const isNew = !previous;
      const hasMoved =
        !!previous && (previous.lat !== location.lat || previous.lng !== location.lng);

      let marker = this.markersById.get(location.id);
      if (!marker) {
        marker = L.marker([location.lat, location.lng], { icon: markerIcon() }).addTo(this.map);
        this.markersById.set(location.id, marker);
      } else if (hasMoved) {
        marker.setLatLng([location.lat, location.lng]);
      }

      const name =
        [location.firstName, location.lastName].filter(Boolean).join(' ') || location.email;
      const place = [location.city, location.region, location.country].filter(Boolean).join(', ');
      marker.bindPopup(
        `<strong>${escapeHtml(name)}</strong>${place ? `<br>${escapeHtml(place)}` : ''}`,
      );

      this.locationsById.set(location.id, location);

      if (this.hasLoadedOnce && (isNew || hasMoved)) {
        this.glow(marker);
      }
    }

    for (const id of [...this.markersById.keys()]) {
      if (!seenIds.has(id)) {
        this.markersById.get(id)?.remove();
        this.markersById.delete(id);
        this.locationsById.delete(id);
      }
    }

    this.hasLoadedOnce = true;
  }

  /** Temporarily marks a marker's DOM element as "glowing" (a brighter
   *  accent that fades back to the normal steady pulse - see
   *  world-map.component.scss), so a staff member watching the map notices
   *  exactly which library user just showed up or moved. */
  private glow(marker: L.Marker): void {
    const el = marker.getElement();
    if (!el) {
      return;
    }
    el.classList.add('map-marker--glow');
    setTimeout(() => el.classList.remove('map-marker--glow'), GLOW_DURATION_MS);
  }

  private async addCountryBordersLayer(): Promise<void> {
    if (!this.map) {
      return;
    }
    try {
      if (!this.countryBordersData) {
        const response = await fetch(COUNTRY_BORDERS_URL);
        this.countryBordersData = (await response.json()) as GeoJSON.FeatureCollection;
      }
      if (!this.map) {
        return;
      }
      L.geoJSON(this.countryBordersData, {
        style: { color: COUNTRY_BORDER_COLOR, weight: 1, fillOpacity: 0, opacity: 0.85 },
        interactive: false,
      }).addTo(this.map);
    } catch {
      // Purely decorative - an offline/failed fetch just leaves the map
      // without the borders overlay rather than erroring.
    }
  }

  ngOnDestroy(): void {
    this.locationsSubscription?.unsubscribe();
    this.map?.remove();
    this.map = undefined;
  }
}
