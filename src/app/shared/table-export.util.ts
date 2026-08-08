import { Workbook } from 'exceljs';
import { saveAs } from 'file-saver';

// The Material-table equivalent of grid-export.util.ts's exportGridToExcel,
// which requires a live DevExtreme grid instance and so doesn't work for
// migrated screens anymore. This takes a plain array instead - callers pass
// their already-filtered rows (whatever's currently on screen after the
// column filters are applied), so the export always matches what's visible,
// same as the original's grid export did.
export interface ExcelColumn<T> {
  header: string;
  value: (row: T) => string | number | Date | null | undefined;
}

export function exportToExcel<T>(data: T[], columns: ExcelColumn<T>[], fileName: string, worksheetName = 'Sheet1'): void {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet(worksheetName);

  worksheet.columns = columns.map((column) => ({ header: column.header, width: 22 }));
  data.forEach((row) => worksheet.addRow(columns.map((column) => column.value(row))));
  worksheet.getRow(1).font = { bold: true };

  workbook.xlsx.writeBuffer().then((buffer) => {
    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), fileName);
  });
}
