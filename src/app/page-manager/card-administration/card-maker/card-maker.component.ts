import { Component, NgZone, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { take } from 'rxjs/operators';
import { Card, CardComponent } from '../../common/models/editor/card.model';
import { CardService } from '../../common/services/card.service';

@Component({
    selector: 'app-card-maker',
    templateUrl: './card-maker.component.html',
    standalone: false
})
export class CardMakerComponent implements OnInit {
  loading: Promise<any> = new Promise((resolve) => resolve(false));

  breadCrumbItems: Array<{}>;

  editedCard: CardComponent;

  card_line: {} = {};

  imageSelectVisible = false;

  confirmPageSaveVisible = false;

  confirmPageCancelVisible = false;

  htmlContent: string;

  mode: string = 'edit';

  currentCard: Card;

  editedField: string;

  constructor(private route: ActivatedRoute,
    public ngZone: NgZone,
    public router: Router,
    public cardService: CardService,) {}

  ngOnInit(): void {
    this.breadCrumbItems = [{ label: 'Admin'}, { label: 'Card Administration', path: '/cards/card-administration' }];

    this.route.params.pipe(take(1)).subscribe(queryParams => {
      if(queryParams['id'] != null){
        this.cardService.getById(queryParams['id']).then(p => {
            this.currentCard = p;
            this.card_line = {
              'height': this.currentCard.line_height + 'px',
              'width': this.currentCard.line_width + '%',
              'background-color': this.currentCard.line_color
            }
            this.currentCard.dbId = queryParams['id'];
            this.mode = 'edit';
            this.breadCrumbItems.push({ label: 'Edit ' + this.currentCard.name, active: true })
        },err => console.error('Error in Card Maker Admin', err));
      } else {
        this.mode = 'edit';
        this.breadCrumbItems.push({ label: 'Create New Card', active: true })
        this.currentCard = { ...new Card()};
        this.card_line = {
          'height': this.currentCard.line_height + 'px',
          'width': this.currentCard.line_width + '%',
          'background-color': this.currentCard.line_color
        }
      }
      this.loading = new Promise((resolve) => resolve(true));
    },err => console.error('Error in Card Maker Admin', err));
  }

  returnToCardAdministrator(){
    this.ngZone.run(() => {
      this.router.navigate(['/cards/card-administration']);
    });
  }

  showSavePopup(){
    this.confirmPageSaveVisible = true;
  }

  showCancelPopup(){
    this.confirmPageCancelVisible = true;
  }

  saveChanges(){
    let p: Promise<any>;

    if(this.currentCard.dbId){
      p = this.cardService.update(this.currentCard.dbId, this.currentCard);
    } else {
      p = this.cardService.add(this.currentCard);
    }

    p.then(() => {
      this.closeSaveChanges();
      this.returnToCardAdministrator();
    });
  }

  closeSaveChanges(){
    this.confirmPageSaveVisible = false;
  }

  cancelChanges(){
    this.closeCancelChanges();
    this.returnToCardAdministrator();
  }

  closeCancelChanges(){
    this.confirmPageCancelVisible = false;
  }

  preview(){
    if(this.mode == "edit"){
      this.mode = 'preview'
    } else if(this.mode == 'preview'){
      this.mode = 'edit';
    }
  }
}
