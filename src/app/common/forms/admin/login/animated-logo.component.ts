import { Component } from '@angular/core';

// Ported from impact-discipleship-library-manager-new's lib-animated-logo.
// Recreates impact-logo.png for the login screen, but with the globe
// actually spinning instead of being a static raster. Everything except the
// globe's motion is the original artwork's own pixels, radius-masked out of
// the source PNG rather than redrawn, so it stays true to the original:
//  - impact-logo-ring.png: the ring+arrow, inner disk erased.
//  - impact-logo-globe.png: the continent line art, ring and text-band
//    erased, cropped to a tile the size of the globe's clip circle. Two
//    copies are placed side by side and scrolled continuously, which reads
//    as the globe turning without needing a true 3D projection.
// "IMPACT" is set in Rockwell (the original's actual face - a slab serif,
// not the sans-serif "Impact" font the name suggests) at its Regular weight
// - weight values >=600 all rendered identically since Rockwell only ships
// Regular/Bold as static instances, so anything asking for "semi-bold" just
// snapped to Bold. Negative CSS letter-spacing pulls "I"/"T" in so they read
// as part of the ring, matching the source image - flat, not arced, and
// drawn last so it's unambiguously in front.
@Component({
    selector: 'app-animated-logo',
    standalone: false,
    template: `
    <div class="animated-logo">
      <svg class="logo-svg" viewBox="0 0 735 658" aria-hidden="true">
        <defs>
          <clipPath id="logo-globe-clip">
            <circle cx="350" cy="328.5" r="286" />
          </clipPath>
        </defs>

        <g clip-path="url(#logo-globe-clip)">
          <circle cx="350" cy="328.5" r="286" fill="#e3edf9" />
          <g class="globe-scroll">
            <image x="64" y="42.5" width="572" height="572" href="assets/impact-logo-globe.png" />
            <image x="636" y="42.5" width="572" height="572" href="assets/impact-logo-globe.png" />
          </g>
        </g>

        <text class="logo-text" x="350" y="415" text-anchor="middle">IMPACT</text>

        <!-- the original artwork's ring+arrow, unmodified except for a transparent center -->
        <image href="assets/impact-logo-ring.png" x="0" y="0" width="735" height="658" />
      </svg>
    </div>
  `,
    styles: `
    .animated-logo {
      width: 172px;
      aspect-ratio: 735 / 658;
    }

    .logo-svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    .globe-scroll {
      animation: logo-globe-scroll 22s linear infinite;
    }

    @keyframes logo-globe-scroll {
      to {
        transform: translateX(-572px);
      }
    }

    .logo-text {
      font-family: Rockwell, 'Rockwell Nova', 'Roboto Slab', Arvo, 'Courier New', serif;
      font-weight: 500;
      font-size: 240px;
      letter-spacing: -11px;
      fill: #4b92fe;
    }
  `,
})
export class AnimatedLogoComponent {}
