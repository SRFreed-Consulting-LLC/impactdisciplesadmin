import { moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import {
  BlockType,
  EmailBlock,
  EmailRow,
  SocialNetworkLink,
  createBlock,
  createRow
} from 'src/app/common/models/admin/email-design.model';

// Drop-list id conventions (same prefix scheme as the form builder's
// field-drop.util.ts, which this file is adapted from):
//   palette-blocks        - the Add panel's block chips (drag to COPY)
//   palette-layouts       - the Add panel's layout tiles (drag to COPY a row)
//   col-<columnId>        - a column's block list
//   rows-<sectionId>      - a section's row list
export const BLOCK_PALETTE_ID = 'palette-blocks';
export const LAYOUT_PALETTE_ID = 'palette-layouts';
export const COLUMN_PREFIX = 'col-';
export const ROWS_PREFIX = 'rows-';

// Layout palette entries: column width percentages for the prebuilt rows.
export interface LayoutPreset {
  label: string;
  widths: number[];
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { label: '1 column', widths: [100] },
  { label: '2 columns', widths: [50, 50] },
  { label: '3 columns', widths: [33.33, 33.34, 33.33] },
  { label: '4 columns', widths: [25, 25, 25, 25] },
  { label: '2/3 + 1/3', widths: [66.66, 33.34] },
  { label: '1/3 + 2/3', widths: [33.34, 66.66] }
];

export function createRowFromLayout(preset: LayoutPreset): EmailRow {
  return createRow(preset.widths.length, preset.widths);
}

// See field-drop.util.ts for why this structural shape exists instead of
// CdkDragDrop<T> (differently-typed [cdkDropListData] per list makes a
// single CdkDragDrop parameter type impossible).
export interface BlockDropEvent {
  previousContainer: { id: string; data: unknown };
  container: { id: string; data: unknown };
  previousIndex: number;
  currentIndex: number;
}

/**
 * The organisation's own details, applied to a freshly created block.
 *
 * Empty/absent members mean "leave the block's own defaults alone", so a
 * caller that has not loaded config yet still gets a working block rather
 * than a broken one.
 */
export interface BlockSeed {
  socialLinks?: SocialNetworkLink[];
  addressHtml?: string;
}

/** Fills a new block from BlockSeed. Only touches blocks that have somewhere
 *  for these details to go; everything else passes through untouched. */
export function applyBlockSeed(block: EmailBlock, seed?: BlockSeed): void {
  if (!seed) {
    return;
  }
  if (block.type === 'social' && seed.socialLinks?.length) {
    block.props.networks = seed.socialLinks.map((link) => ({ ...link }));
  }
  if (block.type === 'footer' && seed.addressHtml) {
    block.props.addressHtml = seed.addressHtml;
  }
}

// Shared handler for block drops: palette -> column (copy via createBlock),
// column -> same column (reorder), column -> other column (transfer).
// Returns true when it changed the design (callers wrap in state.commit()).
export function handleBlockDrop(event: BlockDropEvent, seed?: BlockSeed): boolean {
  if (!event.container.id.startsWith(COLUMN_PREFIX)) {
    return false;
  }

  if (event.previousContainer.id === BLOCK_PALETTE_ID) {
    const type = (event.previousContainer.data as BlockType[])[event.previousIndex];
    const block = createBlock(type);
    // createBlock lives in the pure design model and knows nothing about this
    // organisation, so the caller fills in what only the app can know -
    // social urls and the postal address, both already on the config doc.
    applyBlockSeed(block, seed);
    (event.container.data as EmailBlock[]).splice(event.currentIndex, 0, block);
    return true;
  }

  if (!event.previousContainer.id.startsWith(COLUMN_PREFIX)) {
    return false;
  }

  if (event.previousContainer === event.container) {
    moveItemInArray(event.container.data as EmailBlock[], event.previousIndex, event.currentIndex);
    return true;
  }

  transferArrayItem(
    event.previousContainer.data as EmailBlock[],
    event.container.data as EmailBlock[],
    event.previousIndex,
    event.currentIndex
  );
  return true;
}

// Shared handler for row drops: layout palette -> section (copy via
// createRowFromLayout), section -> same/other section (reorder/transfer).
export function handleRowDrop(event: BlockDropEvent): boolean {
  if (!event.container.id.startsWith(ROWS_PREFIX)) {
    return false;
  }

  if (event.previousContainer.id === LAYOUT_PALETTE_ID) {
    const preset = (event.previousContainer.data as LayoutPreset[])[event.previousIndex];
    (event.container.data as EmailRow[]).splice(event.currentIndex, 0, createRowFromLayout(preset));
    return true;
  }

  if (!event.previousContainer.id.startsWith(ROWS_PREFIX)) {
    return false;
  }

  if (event.previousContainer === event.container) {
    moveItemInArray(event.container.data as EmailRow[], event.previousIndex, event.currentIndex);
    return true;
  }

  transferArrayItem(
    event.previousContainer.data as EmailRow[],
    event.container.data as EmailRow[],
    event.previousIndex,
    event.currentIndex
  );
  return true;
}
