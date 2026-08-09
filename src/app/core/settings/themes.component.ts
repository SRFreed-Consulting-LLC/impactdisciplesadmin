import { Component } from '@angular/core';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';
import { COLOR_THEMES, DEFAULT_COLOR_THEME, ThemeService } from 'src/app/common/services/utils/theme.service';

@Component({
    selector: 'app-themes',
    templateUrl: './themes.component.html',
    styleUrls: ['./themes.component.scss'],
    standalone: false
})
export class ThemesComponent {
  colorThemes = COLOR_THEMES;

  constructor(public themeService: ThemeService) {}

  onDarkModeChange(event: MatSlideToggleChange): void {
    this.themeService.setDarkMode(event.checked);
  }

  onColorThemeChange(id: string): void {
    this.themeService.setColorTheme(id);
  }

  // 'dark-theme' is layered on alongside the option's own theme-{id} class
  // (when previewing in dark mode) so the swatch shows exactly the colors
  // that option would apply right now - same trick
  // impact-discipleship-library-manager-new's ColorThemePickerComponent
  // uses for its own preview dots.
  swatchClasses(id: string): string {
    const themeClass = id === DEFAULT_COLOR_THEME ? '' : `theme-${id}`;
    return [themeClass, this.themeService.darkMode() ? 'dark-theme' : ''].filter(Boolean).join(' ');
  }
}
