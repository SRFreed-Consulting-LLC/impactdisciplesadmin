import { Component, NgZone, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { DxDataGridComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import { Page } from '../common/models/editor/page.model';
import { CardService } from '../common/services/card.service';
import { PageService } from '../common/services/page.service';
import { Card } from '../common/models/editor/card.model';
import notify from 'devextreme/ui/notify';

@Component({
  selector: 'app-card-manager',
  templateUrl: './card-administration.component.html'
})
export class CardAdministrationComponent implements OnInit {
  @ViewChild("cardTable") cardTable: DxDataGridComponent;

  breadCrumbItems: Array<{}>;

  dataSource: any = {};

  currentCard: Card;

  addCardVisible = false;

  confirmPublishCardVisible = false;

  copyCardVisible = false;

  newname: string;

  constructor(public cardService: CardService,
    public pageService: PageService,
    public ngZone: NgZone,
    public router: Router){
    this.dataSource = new CustomStore({
      key: "dbId",
      loadMode: "raw",
      load: function (loadOptions: any) {
        return cardService.getAll();
      },
      update: function(key: any, value: Card) {
        return cardService.update(key, value);
      },
      remove: function (id: any) {
        return cardService.delete(id);
      },
    });
  }

  ngOnInit() {
    this.breadCrumbItems = [{ label: 'Admin' }, { label: 'Card Administration', active: true }];
  }

  onRowUpdating(options) {
    options.newData = Object.assign(options.oldData, options.newData);
  }

  displayPublishcardWarning(e){
    this.currentCard = e.row.data;
    this.confirmPublishCardVisible = true;
  }

  closePublishcardWarning(){
    this.confirmPublishCardVisible = false;
  }

  publishCard(e){
    let pagesToUpdate: Page[] = [];
    new Promise((resolve, reject) => {
      this.pageService.getAll().then(async pages => {
        await pages.forEach(async page => {
          await page.cards.forEach(card => {
            if(card && card.dbId == this.currentCard.dbId) {
              Object.assign(card, this.currentCard)
              pagesToUpdate.push(page);
            }
          });
        });
        resolve(pagesToUpdate);
      },err => console.error('Error in Card Admin', err))
    }).then( p => {
      pagesToUpdate.forEach(page => {
        this.pageService.update(page.dbId, page);
      });
    }).then(()=>{
      notify({
        message: 'Card successfully published!',
        position: 'top',
        width: 600,
        type: 'success'
      });

      this.closePublishcardWarning();
    }).catch((error) => {
      console.error('Error in Card Admin.', error);
      this.closePublishcardWarning();
    });;
  }

  displayCardPreview(event: any){
    this.router.navigate(['/cards/card-viewer', event.row.data.dbId, 'preview']);
  }

  displayCardEdit(event: any){
    this.router.navigate(['/cards/card-maker', event.row.data.dbId, 'edit']);
  }

  displayCardAdd = () => {
    this.addCardVisible = true;
  }

  onToolbarPreparing(e) {
    e.toolbarOptions.items.unshift({
      location: 'after',
      widget: 'dxButton',
      options: {
          icon: 'plus',
          onClick: this.addCard.bind(this)
      }
    });
  }

  addCard(){
    this.ngZone.run(() => {
      this.router.navigate(['/cards/card-maker']);
    });
  }

  displayCopyCard(e) {
    this.currentCard = e.row.data;
    this.copyCardVisible = true;
  }

  closeDisplayCopyCard() {
    this.copyCardVisible = false;
  }

  copyCard() {
    this.closeDisplayCopyCard();
    this.currentCard.name = this.newname;
    this.currentCard.dbId = "";
    this.cardService.add(this.currentCard);
    this.cardTable.instance.refresh();
  }

  getScreenHeight(): number{
    return window.innerHeight*.7;
  }
}
