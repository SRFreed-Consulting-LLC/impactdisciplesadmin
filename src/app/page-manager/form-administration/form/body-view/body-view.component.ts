import { Component, Input, OnInit } from '@angular/core';
import notify from 'devextreme/ui/notify';
import { input_type_values } from 'src/app/page-manager/common/lists/card-fields.list';
import { Form, FormInputs, FormRow } from 'src/app/page-manager/common/models/editor/form.model';
import { FormService } from 'src/app/page-manager/common/services/forms.service';

@Component({
    selector: 'app-form-body-view',
    templateUrl: './body-view.component.html',
    standalone: false
})
export class FormBodyViewComponent implements OnInit {
  @Input('form') form: Form;

  @Input('view') view: string = 'edit';

  inputTypes: string[] = input_type_values;

  helpVisible = false;

  row_style: {} = {};

  button_component: {} = {};

  button_area: {} = {};

  formToSubmit: any = {};

  constructor(private formsService: FormService) {}

  toggleHelp() {
    this.helpVisible = !this.helpVisible;
  }

  ngOnInit(): void {
    this.button_component = {
      'font-size': this.form.button.button_size + 'px',
      'border-width': this.form.button.button_border + 'px',
      'margin-top': this.form.button.button_margin_top + '%',
      'margin-left': this.form.button.button_margin_left + '%',
    };
    this.button_area = {
      'background-color': this.form.button.button_area,
      height: '100%',
      width: '100%',
    };
  }

  addrow() {
    this.form.rows.push({ ...new FormRow() });
  }

  deleterow(row: number) {
    this.form.rows.splice(row, 1);
  }

  addform(row: number) {
    let retval: FormInputs = { ...new FormInputs() };
    retval.span = 12;
    this.form.rows[row].inputs.push({ ...retval });
  }

  deleteform(row: number, form: number) {
    this.form.rows[row].inputs.splice(form, 1);
  }

  drop(e, rows) {
    rows.splice(e.currentIndex, 0, rows.splice(e.previousIndex, 1)[0]);
  }

  slide(e, inputs) {
    inputs.splice(e.currentIndex, 0, inputs.splice(e.previousIndex, 1)[0]);
  }

  onListReorder(e) {
    const list = this.form.rows.splice(e.fromIndex, 1)[0];
    this.form.rows.splice(e.toIndex, 0, list);
  }

  saveForm(e) {
    this.formToSubmit.dbId = this.form.dbId;
    // this.formToSubmit.submitted_by_display_name = this.authService.authDao.currentAgent$.getValue()?.p_agent_name;
    // this.formToSubmit.submitted_by_email = this.authService.authDao.currentAgent$.getValue()?.p_email;
    this.formToSubmit.submitted_date = new Date().toUTCString();

    this.formsService
      .saveSubmittedForm(this.formToSubmit.dbId, this.formToSubmit)
      .then((f) => {
        notify({
          message: 'Form Successfully Submitted!',
          position: 'top',
          width: 600,
          type: 'success'
        });
      })
      .catch((error) => {
        console.error('Error in Body View.', error);
      });
  }
}
