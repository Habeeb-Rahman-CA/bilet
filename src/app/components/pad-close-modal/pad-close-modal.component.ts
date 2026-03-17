import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-pad-close-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pad-close-modal.component.html',
  styleUrl: './pad-close-modal.component.css'
})
export class PadCloseModalComponent {
  @Input() show: boolean = false;
  @Output() action = new EventEmitter<'save' | 'delete' | 'force' | 'cancel'>();
}
