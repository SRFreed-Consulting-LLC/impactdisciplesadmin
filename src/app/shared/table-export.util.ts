// The Material-table equivalent of grid-export.util.ts's exportGridToExcel,
// which requires a live DevExtreme grid instance and so doesn't work for
// migrated screens anymore. This takes a plain array instead - callers pass
// their already-filtered rows (whatever's currently on screen after the
// column filters are applied), so the export always matches what's visible,
// same as the original's grid export did.
//
// ExcelJS (+ its jszip/lodash baggage, ~1 MB) is loaded on demand via a
// dynamic import the first time someone actually exports (2026-08-20
// refactor sweep): this util is imported by the shared data grid, which is
// eager via SharedModule, so a static import shipped the whole library in
// every user's initial bundle.
export interface ExcelColumn<T> {
  header: string;
  value: (row: T) => string | number | Date | null | undefined;
}

export async function exportToExcel<T>(
  data: T[],
  columns: ExcelColumn<T>[],
  fileName: string,
  worksheetName = 'Sheet1'
): Promise<void> {
  const [{ Workbook }, { saveAs }] = await Promise.all([import('exceljs'), import('file-saver')]);

  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet(worksheetName);

  worksheet.columns = columns.map((column) => ({ header: column.header, width: 22 }));
  data.forEach((row) => worksheet.addRow(columns.map((column) => column.value(row))));
  worksheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer], { type: 'application/octet-stream' }), fileName);
}
