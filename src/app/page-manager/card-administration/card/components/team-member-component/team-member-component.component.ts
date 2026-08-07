import { Component, Input, OnInit } from '@angular/core';
import { CardComponent, CardComponentTeamMember } from 'src/app/page-manager/common/models/editor/card.model';

@Component({
    selector: 'app-team-member-component',
    templateUrl: './team-member-component.component.html',
    standalone: false
})
export class TeamMemberComponentComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "dislpay";

  card_backup: CardComponent = {... new CardComponent()};

  editedComponent: CardComponentTeamMember;

  ag_team_member_image: {} = {};

  viewConfig = false;

  imageSelectVisible = false;

  editedField: string;


  constructor() {}

  ngOnInit(): void {
    this.card_backup = Object.assign(this.card_backup, this.component);
    this.ag_team_member_image =  {
      'background-image': 'url(' + this.component.team_member.url + ')',
    }
  }

  showPopup(){
    this.viewConfig = true;
  }

  displayImageSelection(fieldname: string, component: CardComponentTeamMember){
    this.editedField = fieldname;
    this.editedComponent = component;
    this.imageSelectVisible = true;
  }

  imageSelectClosed(event){
    this.imageSelectVisible = event;
  }

  resetForm(){
    this.card_backup = Object.assign(this.component, this.card_backup);
    this.viewConfig = false;
  }

  getScreenHeight(): number{
    return window.innerHeight*.6;
  }


}
