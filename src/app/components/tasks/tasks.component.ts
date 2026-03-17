import { Component, Input, Output, EventEmitter, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Note } from '../../models/interfaces';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tasks.component.html',
  styleUrls: ['./tasks.component.css']
})
export class TasksComponent {
  @Input() notes: Note[] = [];
  @Input() selectedNoteId: number | null = null;
  @Input() editingNoteId: number | null = null;
  @Input() isConfirmingDeleteId: number | null = null;
  @Input() spellCheckEnabled = false;

  @Output() noteKeyDown = new EventEmitter<KeyboardEvent>();
  @Output() selectNoteAction = new EventEmitter<{ note: Note, event: MouseEvent }>();
  @Output() editKeyDown = new EventEmitter<{ event: KeyboardEvent, note: Note }>();

  @ViewChild('noteInput') noteInput!: ElementRef<HTMLDivElement>;
  @ViewChild('editInput') editInput!: ElementRef<HTMLDivElement>;

  handleNoteKeyDown(event: KeyboardEvent) {
    this.noteKeyDown.emit(event);
  }

  selectNote(note: Note, event: MouseEvent) {
    this.selectNoteAction.emit({ note, event });
  }

  handleEditKeyDown(event: KeyboardEvent, note: Note) {
    this.editKeyDown.emit({ event, note });
  }

  formatContent(content: string): string {
    if (!content) return '';
    return content.replace(/\n/g, '<br>');
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr.replace(' ', 'T') + 'Z');
      return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return dateStr;
    }
  }
}
