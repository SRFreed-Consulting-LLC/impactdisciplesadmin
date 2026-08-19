import { Component, Input } from '@angular/core';
import {
  BlockAlign,
  BlockStyles,
  BorderStyle,
  BoxSides,
  ZERO_SIDES,
  createDefaultBlockStyles
} from 'src/app/common/models/admin/email-design.model';
import { DesignerStateService } from '../designer-state.service';

// Anything carrying the shared style kit: a block or a row.
export interface StyledTarget {
  styles: BlockStyles;
  mobileStyles: Partial<BlockStyles>;
  stylesLinked: boolean;
}

// The Mailchimp block Style panel: Desktop | Mobile tabs with a link/unlink
// toggle, per-side padding, border (8 CSS styles), per-corner rounding,
// background color, alignment, and "Restore default styles".
//
// Editing model: while linked (or on the Desktop tab) writes land on
// `styles`; unlinking seeds `mobileStyles` with a copy and the Mobile tab
// then writes phone-only overrides. The canvas and compiler both resolve
// via resolveMobileStyles(), so what you see per-device is what sends.
@Component({
    selector: 'app-block-style-editor',
    templateUrl: './block-style-editor.component.html',
    styleUrls: ['./block-style-editor.component.scss'],
    standalone: false
})
export class BlockStyleEditorComponent {
  @Input({ required: true }) target!: StyledTarget;

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

  constructor(private state: DesignerStateService) {}

  // The style set currently being viewed/edited.
  get edited(): BlockStyles {
    if (this.activeDevice === 'mobile' && !this.target.stylesLinked) {
      return { ...this.target.styles, ...this.target.mobileStyles };
    }
    return this.target.styles;
  }

  get editingMobileOverrides(): boolean {
    return this.activeDevice === 'mobile' && !this.target.stylesLinked;
  }

  setDevice(device: 'desktop' | 'mobile'): void {
    this.activeDevice = device;
  }

  toggleLinked(): void {
    const target = this.target;
    this.state.commit(() => {
      if (target.stylesLinked) {
        target.stylesLinked = false;
        target.mobileStyles = JSON.parse(JSON.stringify(target.styles));
      } else {
        target.stylesLinked = true;
        target.mobileStyles = {};
      }
    });
  }

  restoreDefaults(): void {
    const target = this.target;
    this.state.commit(() => {
      target.styles = createDefaultBlockStyles();
      target.mobileStyles = {};
      target.stylesLinked = true;
    });
    this.activeDevice = 'desktop';
  }

  // One writer for every field: applies to `styles` or, when unlinked and on
  // the Mobile tab, to the mobileStyles overlay.
  private write(apply: (styles: BlockStyles) => void): void {
    const target = this.target;
    const mobile = this.editingMobileOverrides;
    this.state.commit(() => {
      if (mobile) {
        const merged = { ...target.styles, ...target.mobileStyles } as BlockStyles;
        const draft = JSON.parse(JSON.stringify(merged)) as BlockStyles;
        apply(draft);
        target.mobileStyles = draft;
      } else {
        apply(target.styles);
      }
    });
  }

  setPadding(side: 'top' | 'right' | 'bottom' | 'left', value: string | number): void {
    const px = Math.max(0, Number(value) || 0);
    this.write((styles) => {
      styles.padding = { ...styles.padding, [side]: px };
    });
  }

  get editedMargin(): BoxSides {
    return this.edited.margin ?? ZERO_SIDES;
  }

  setMargin(side: 'top' | 'right' | 'bottom' | 'left', value: string | number): void {
    const px = Math.max(0, Number(value) || 0);
    this.write((styles) => {
      styles.margin = { ...(styles.margin ?? ZERO_SIDES), [side]: px };
    });
  }

  setRadius(corner: 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft', value: string | number): void {
    const px = Math.max(0, Number(value) || 0);
    this.write((styles) => {
      styles.borderRadius = { ...styles.borderRadius, [corner]: px };
    });
  }

  setAlign(align: BlockAlign): void {
    this.write((styles) => {
      styles.align = align;
    });
  }

  setBackground(color: string | null): void {
    this.write((styles) => {
      styles.backgroundColor = color;
    });
  }

  setBorderStyle(style: 'none' | BorderStyle): void {
    this.write((styles) => {
      if (style === 'none') {
        styles.border = null;
        return;
      }
      styles.border = styles.border
        ? { ...styles.border, style }
        : { width: 1, style, color: '#dfe3e8' };
    });
  }

  setBorderWidth(value: string | number): void {
    const px = Math.max(0, Number(value) || 0);
    this.write((styles) => {
      if (styles.border) {
        styles.border = { ...styles.border, width: px };
      }
    });
  }

  setBorderColor(color: string): void {
    this.write((styles) => {
      if (styles.border) {
        styles.border = { ...styles.border, color };
      }
    });
  }
}
