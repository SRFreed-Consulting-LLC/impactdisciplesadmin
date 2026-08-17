import { Component } from '@angular/core';
import { BorderStyle, GlobalStyleSet } from 'src/app/common/models/admin/email-design.model';
import { DesignerStateService } from '../designer-state.service';

// The Styles tab: email-wide defaults every block inherits, one full set
// for desktop and a sparse override set for mobile (the compiler emits the
// mobile differences as @media rules).
@Component({
    selector: 'app-global-styles-panel',
    templateUrl: './global-styles-panel.component.html',
    styleUrls: ['./global-styles-panel.component.scss'],
    standalone: false
})
export class GlobalStylesPanelComponent {
  activeDevice: 'desktop' | 'mobile' = 'desktop';

  readonly borderStyles: BorderStyle[] = [
    'solid',
    'dashed',
    'dotted',
    'double',
    'inset',
    'outset',
    'groove',
    'ridge'
  ];

  readonly fontFamilies = [
    'Helvetica, Arial, sans-serif',
    'Arial, Helvetica, sans-serif',
    'Georgia, Times New Roman, serif',
    'Times New Roman, Georgia, serif',
    'Verdana, Geneva, sans-serif',
    'Tahoma, Geneva, sans-serif',
    'Trebuchet MS, Helvetica, sans-serif',
    'Courier New, Courier, monospace'
  ];

  constructor(public state: DesignerStateService) {}

  // The set being displayed: desktop, or desktop merged with the mobile
  // overrides (what actually applies on phones).
  get edited(): GlobalStyleSet {
    const desktop = this.state.design.globalStyles.desktop;
    if (this.activeDevice === 'mobile') {
      return { ...desktop, ...this.state.design.globalStyles.mobile };
    }
    return desktop;
  }

  fontLabel(family: string): string {
    return family.split(',')[0];
  }

  // Every write goes through one mutator: on Desktop it edits the full set;
  // on Mobile it lands in the sparse override object. `section` names the
  // GlobalStyleSet key being replaced wholesale (paragraph, button, ...).
  private write(mutate: (set: GlobalStyleSet) => void): void {
    this.state.commit((design) => {
      if (this.activeDevice === 'mobile') {
        const merged = JSON.parse(
          JSON.stringify({ ...design.globalStyles.desktop, ...design.globalStyles.mobile })
        ) as GlobalStyleSet;
        mutate(merged);
        design.globalStyles.mobile = merged;
      } else {
        mutate(design.globalStyles.desktop);
      }
    });
  }

  setEmailBackground(color: string): void {
    this.write((set) => (set.emailBackgroundColor = color));
  }

  setBodyBackground(color: string): void {
    this.write((set) => (set.bodyBackgroundColor = color));
  }

  setParagraphFont(family: string): void {
    this.write((set) => (set.paragraph = { ...set.paragraph, fontFamily: family }));
  }

  setParagraphSize(value: string | number): void {
    const px = Math.min(32, Math.max(10, Number(value) || 14));
    this.write((set) => (set.paragraph = { ...set.paragraph, fontSize: px }));
  }

  setParagraphColor(color: string): void {
    this.write((set) => (set.paragraph = { ...set.paragraph, color }));
  }

  setHeadingFont(family: string): void {
    this.write((set) => (set.heading = { ...set.heading, fontFamily: family }));
  }

  setHeadingColor(color: string): void {
    this.write((set) => (set.heading = { ...set.heading, color }));
  }

  setHeadingSize(level: 'h1' | 'h2' | 'h3' | 'h4', value: string | number): void {
    const px = Math.min(60, Math.max(12, Number(value) || 20));
    this.write((set) => (set.heading = { ...set.heading, sizes: { ...set.heading.sizes, [level]: px } }));
  }

  setLinkColor(color: string): void {
    this.write((set) => (set.link = { ...set.link, color }));
  }

  setLinkUnderline(underline: boolean): void {
    this.write((set) => (set.link = { ...set.link, underline }));
  }

  setButtonBackground(color: string): void {
    this.write((set) => (set.button = { ...set.button, backgroundColor: color }));
  }

  setButtonColor(color: string): void {
    this.write((set) => (set.button = { ...set.button, color }));
  }

  setButtonRadius(value: string | number): void {
    const px = Math.min(30, Math.max(0, Number(value) || 0));
    this.write((set) => (set.button = { ...set.button, borderRadius: px }));
  }

  setButtonFontSize(value: string | number): void {
    const px = Math.min(24, Math.max(10, Number(value) || 14));
    this.write((set) => (set.button = { ...set.button, fontSize: px }));
  }

  setDividerStyle(style: BorderStyle): void {
    this.write((set) => (set.divider = { ...set.divider, style }));
  }

  setDividerThickness(value: string | number): void {
    const px = Math.min(12, Math.max(1, Number(value) || 1));
    this.write((set) => (set.divider = { ...set.divider, thickness: px }));
  }

  setDividerColor(color: string): void {
    this.write((set) => (set.divider = { ...set.divider, color }));
  }

  resetMobileOverrides(): void {
    this.state.commit((design) => {
      design.globalStyles.mobile = {};
    });
  }

  get hasMobileOverrides(): boolean {
    return Object.keys(this.state.design.globalStyles.mobile).length > 0;
  }
}
