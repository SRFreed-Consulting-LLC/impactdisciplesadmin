import { Component } from '@angular/core';
import { COLOR_THEMES, ThemeService } from 'src/app/common/services/utils/theme.service';

@Component({
    selector: 'app-themes',
    templateUrl: './themes.component.html',
    styleUrls: ['./themes.component.scss'],
    standalone: false
})
export class ThemesComponent {
  colorThemes = COLOR_THEMES;

  constructor(public themeService: ThemeService) {}

  onColorThemeChange(id: string): void {
    this.themeService.setColorTheme(id);
  }

  // Each option's swatch is wrapped in that option's own theme-{id} class so
  // its three dots (ground / card / accent) render exactly the colors that
  // option would apply - no hardcoded swatch-color list to keep in sync.
  // Always a real class now (no empty-string default special case): the old
  // "default has no class" behavior made the default option's swatch inherit
  // whatever theme was currently applied to <html> instead of its own colors.
  swatchClasses(id: string): string {
    return `theme-${id}`;
  }
}
