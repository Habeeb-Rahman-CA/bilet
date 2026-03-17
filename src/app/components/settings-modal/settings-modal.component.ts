import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FontEntry } from '../../services/font.service';

@Component({
  selector: 'app-settings-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './settings-modal.component.html',
  styleUrl: './settings-modal.component.css'
})
export class SettingsModalComponent {
  @Input() show: boolean = false;
  @Input() availableFonts: FontEntry[] = [];
  @Input() selectedFont: string = '';
  @Input() focusedFontIndex: number = 0;

  @Output() close = new EventEmitter<void>();
  @Output() selectFont = new EventEmitter<string>();
  @Output() uploadFont = new EventEmitter<void>();
  @Output() deleteFont = new EventEmitter<{ name: string; event: MouseEvent }>();
}
