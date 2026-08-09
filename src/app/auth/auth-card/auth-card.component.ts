import { Component, Input } from '@angular/core';

/**
 * Material replacement for the impactdisciplescommon submodule's
 * app-single-card (DevExtreme dx-card based) - the centered white card
 * every auth screen is wrapped in. Styled to match it pixel-for-pixel
 * (see auth-card.component.scss for the extracted DevExtreme metrics).
 *
 * title/description are rendered unconditionally, even when empty, to
 * match the original's layout exactly - capture-password-form passes
 * neither, but still relies on the (empty) title row's line-height for
 * its vertical spacing under the logo.
 */
@Component({
    selector: 'app-auth-card',
    templateUrl: './auth-card.component.html',
    styleUrls: ['./auth-card.component.scss'],
    standalone: false
})
export class AuthCardComponent {
  @Input() title?: string;
  @Input() description?: string;
}
