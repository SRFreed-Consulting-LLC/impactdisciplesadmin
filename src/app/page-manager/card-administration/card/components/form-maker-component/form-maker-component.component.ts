import { Component, Input, OnInit } from '@angular/core';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { cta_button_style_values, card_form_data_type_values } from 'src/app/page-manager/common/lists/card-fields.list';
import { CardComponent, CardComponentFormItem, CardComponentUrl } from 'src/app/page-manager/common/models/editor/card.model';
import { Form } from 'src/app/page-manager/common/models/editor/form.model';
import { FormService } from 'src/app/page-manager/common/services/forms.service';


@Component({
    selector: 'app-form-maker-component',
    templateUrl: './form-maker-component.component.html',
    standalone: false
})
export class FormMakerComponentComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = 'edit';

  selectedField: CardComponentFormItem = { ...new CardComponentFormItem() };

  card_backup: CardComponent = { ...new CardComponent() };

  buttonStyles: string[] = cta_button_style_values;

  card_form_data_type_values = card_form_data_type_values;

  formToSubmit: any = {};

  now: Date = new Date();

  button_component: {} = {};

  button_area: {} = {};

  viewConfig = false;

  viewUploaderw = false;

  viewEditPage = false;

  pageSelectVisible = false;

  editedItem: CardComponentFormItem;

  editedUrl: CardComponentUrl;

  editedField: string;

  mode: string;

  constructor(private formsService: FormService, private authService: AdminAuthService) {}

  ngOnInit(): void {
    this.button_component = {
      'font-size': this.component.button.button_size + 'px',
      'border-width': this.component.button.button_border + 'px',
      'margin-top': this.component.button.button_margin_top + '%',
      'margin-left': this.component.button.button_margin_left + '%',
    };
    this.button_area = {
      'background-color': this.component.button.button_area,
      height: '100%',
      width: '100%',
    };
  }

  showPopup() {
    this.card_backup = Object.assign(this.card_backup, this.component);
    this.viewConfig = true;
  }

  resetForm() {
    this.card_backup = Object.assign(this.component, this.card_backup);
    this.viewConfig = false;
  }

  onReorder(e) {
    var visibleRows = e.component.getVisibleRows(),
      toIndex = this.component.gallery.items.indexOf(visibleRows[e.toIndex].data),
      fromIndex = this.component.gallery.items.indexOf(e.itemData);
    this.component.gallery.items.splice(fromIndex, 1);
    this.component.gallery.items.splice(toIndex, 0, e.itemData);
  }

  onRowInserted(options) {
    delete options.data['__KEY__'];
  }

  activateForm() {
    if (!this.component.form.submitted_form_id) {
      let form: Form = { ...new Form() };
      form.name = this.component.form.name;
      this.formsService
        .add(form)
        .then((form) => {
          this.component.form.submitted_form_id = form.dbId;
          this.viewConfig = false;
        })
        .catch((error) => {
          console.error('Error in Forma Maker.', error);
        });
    } else {
      this.viewConfig = false;
    }
  }

  displayFileUploader2(field: string, formItem: CardComponentFormItem) {
    this.editedField = field;
    this.editedItem = formItem;
  }

  saveForm(e) {
    // this.formToSubmit.name = this.component.form.name;
    // //this.formToSubmit.submitted_by_display_name = this.authService.getUser();
    // //this.formToSubmit.submitted_by_email = this.authService.authDao.currentAgent$.getValue()?.p_email;
    // this.formsService
    //   .save(this.component.form.submitted_form_id, this.formToSubmit)
    //   .then((f) => {
    //     this.toster.info('Form Successfully Submitted!');
    //   })
    //   .catch((error) => {
    //     console.error('Error in Forma Maker.', error);
    //   });
  }

  onToolbarPreparing(e) {
    e.toolbarOptions.items.unshift({
      location: 'after',
      widget: 'dxButton',
      options: {
        icon: 'plus',
        onClick: this.displayEditPage.bind(this),
      },
    });
  }

  displayEditPage(e) {
    if (e.row && e.row.data) {
      this.selectedField = e.row.data;
      this.mode = 'edit';
    } else {
      this.selectedField = { ...new CardComponentFormItem() };
      this.mode = 'new';
    }
    this.viewEditPage = true;
  }

  saveEditPage(e) {
    this.selectedField.field_name = this.selectedField.label.split(' ').join('_').toLowerCase();
    if (this.mode == 'new') {
      if (!this.component.form.items) {
        this.component.form.items = [];
      }
      this.component.form.items.push({ ...this.selectedField });
    }
    this.viewEditPage = false;
  }

  onCustomItemCreating(args) {
    let newValue = args.text;
    args.customItem = { type: 'tag', value: newValue };
  }

  checkBoxValueChanged(e, value, item) {
    if (!this.formToSubmit[item]) {
      this.formToSubmit[item] = [];
    }

    if (e.value == true) {
      this.formToSubmit[item].push(value);
    } else if (e.value == false && e.previousValue == true) {
      var idx = this.formToSubmit[item].indexOf(value);
      if (idx !== -1) {
        this.formToSubmit[item].splice(idx, 1);
      }
    }
  }

  getScreenHeight(): number {
    return window.innerHeight * 0.9;
  }

  onSelectionChanged(event) {
    if (event.value == 'Internal Link') {
      this.component.form.link_external = false;
    } else {
      this.component.form.link_external = true;
    }
  }

  displayPageSelection(fieldname: string, component) {
    this.editedField = fieldname;
    this.editedUrl = component;
    this.pageSelectVisible = true;
  }
}
