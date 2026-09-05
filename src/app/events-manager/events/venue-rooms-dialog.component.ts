import { Component, OnInit } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { LocationModel } from '@impact-common/shared/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { SnackbarService } from '../../shared/snackbar.service';

// The Summit venue's rooms + capacities (the Agenda's breakout grid
// columns), edited in a popup off the Summit Info tab - deliberately not an
// inline panel: once set, rooms rarely change (user decision 2026-08-19).
// Loads/saves the pinned isSummitVenue `locations` doc itself, decoupled
// from the event save - the rooms belong to the venue, shared by every
// summit.
@Component({
    selector: 'app-venue-rooms-dialog',
    templateUrl: './venue-rooms-dialog.component.html',
    styleUrls: ['./venue-rooms-dialog.component.scss'],
    standalone: false
})
export class VenueRoomsDialogComponent implements OnInit {
  venue: LocationModel | null = null;
  rooms: LocationModel['trainingrooms'] = [];
  loading = true;
  saving$ = new BehaviorSubject<boolean>(false);

  constructor(
    private dialogRef: MatDialogRef<VenueRoomsDialogComponent>,
    private locationService: LocationService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.locationService.getAllByValue('isSummitVenue', true).then((venues) => {
      this.venue = venues[0] ?? null;
      // RoomComponent mutates this array in place - hand it the real one.
      this.rooms = this.venue?.trainingrooms ?? [];
      this.loading = false;
    });
  }

  onSave(): void {
    if (!this.venue) {
      return;
    }
    this.saving$.next(true);
    this.locationService.update(this.venue.id!, { ...this.venue, trainingrooms: this.rooms })
      .then(() => {
        this.snackbar.success('Venue Rooms Saved');
        this.dialogRef.close(true);
      })
      .catch(() => {
        this.snackbar.somethingWentWrong();
        this.saving$.next(false);
      });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }
}
