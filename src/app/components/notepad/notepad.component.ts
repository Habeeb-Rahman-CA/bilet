import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Pad } from '../../models/interfaces';

@Component({
  selector: 'app-notepad',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notepad.component.html',
  styleUrl: './notepad.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotepadComponent {
  @Input() pads: Pad[] = [];
  @Input() activePad: Pad | null = null;
  @Input() activeTabId: number | null = null;
  @Input() openOrderedTabs: Pad[] = [];
  @Input() draggedTabId: number | null = null;
  @Input() dragEnterId: number | null = null;
  @Input() lineNumbers: number[] = [];
  @Input() padStats: { w: number; c: number; l: number } = { w: 0, c: 0, l: 0 };
  @Input() padText: string = '';
  @Input() selectedPadText: string = '';
  @Input() markedLines: Set<number> = new Set();
  @Input() spellCheckEnabled: boolean = true;

  @Output() switchTabAction = new EventEmitter<number>();
  @Output() closeTabAction = new EventEmitter<{ id: number, event: MouseEvent }>();
  @Output() createPadAction = new EventEmitter<void>();
  @Output() tabDragStart = new EventEmitter<{ event: DragEvent, id: number }>();
  @Output() tabDragOver = new EventEmitter<DragEvent>();
  @Output() tabDragEnter = new EventEmitter<{ event: DragEvent, id: number }>();
  @Output() tabDragLeave = new EventEmitter<DragEvent>();
  @Output() tabDragEnd = new EventEmitter<void>();
  @Output() tabDrop = new EventEmitter<{ event: DragEvent, id: number }>();
  @Output() toggleLineMarkAction = new EventEmitter<number>();
  @Output() padInput = new EventEmitter<void>();
  @Output() padKeyDown = new EventEmitter<{ event: KeyboardEvent, editor: HTMLElement }>();
  @Output() editorScroll = new EventEmitter<Event>();
  @Output() padSelect = new EventEmitter<void>();
  @Output() padPaste = new EventEmitter<ClipboardEvent>();
  @Output() toggleJSONAction = new EventEmitter<void>();
  @Output() toggleBase64Action = new EventEmitter<void>();

  @ViewChild('padEditor') padEditor!: ElementRef<HTMLElement>;

  switchTab(id: number) {
    this.switchTabAction.emit(id);
  }

  createPad() {
    this.createPadAction.emit();
  }

  onCloseTab(id: number, event: MouseEvent) {
    this.closeTabAction.emit({ id, event });
  }

  onTabDragStart(event: DragEvent, id: number) {
    this.tabDragStart.emit({ event, id });
  }

  onTabDragOver(event: DragEvent) {
    this.tabDragOver.emit(event);
  }

  onTabDragEnter(event: DragEvent, id: number) {
    this.tabDragEnter.emit({ event, id });
  }

  onTabDragLeave(event: DragEvent) {
    this.tabDragLeave.emit(event);
  }

  onTabDragEnd() {
    this.tabDragEnd.emit();
  }

  onTabDrop(event: DragEvent, id: number) {
    this.tabDrop.emit({ event, id });
  }

  onPadInput() {
    this.padInput.emit();
  }

  handlePadKeyDown(event: KeyboardEvent, editor: HTMLElement) {
    this.padKeyDown.emit({ event, editor });
  }

  onEditorScroll(event: Event) {
    this.editorScroll.emit(event);
  }

  onPadSelect() {
    this.padSelect.emit();
  }

  handlePadPaste(event: ClipboardEvent) {
    this.padPaste.emit(event);
  }

  toggleJSON() {
    this.toggleJSONAction.emit();
  }

  toggleBase64() {
    this.toggleBase64Action.emit();
  }

  onToggleLineMark(num: number) {
    this.toggleLineMarkAction.emit(num);
  }

  formatContent(content: string): string {
    // This is a helper for display in tabs, usually we want simplified formatting
    return content || '';
  }

  isLineMarked(num: number): boolean {
    return this.markedLines.has(num);
  }
}
