import { Workbook } from 'exceljs';
import { exportDataGrid as exportXLSDataGrid } from 'devextreme/excel_exporter';
import { saveAs } from 'file-saver';
import dxDataGrid from 'devextreme/ui/data_grid';

/**
 * Exports a DevExtreme data grid to an .xlsx file, matching the pattern
 * previously copy-pasted across several grid components (users, purchases,
 * event attendees, etc).
 */
export function exportGridToExcel(gridInstance: dxDataGrid, fileName: string, worksheetName: string = 'Attendees'): void {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet(worksheetName);

  exportXLSDataGrid({
    component: gridInstance,
    worksheet,
    autoFilterEnabled: true,
  }).then(() => {
    workbook.xlsx.writeBuffer().then((buffer) => {
      saveAs(new Blob([buffer], { type: 'application/octet-stream' }), fileName);
    });
  });
}
