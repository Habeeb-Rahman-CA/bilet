import { Component, Input, Output, EventEmitter, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BinItem } from '../../models/interfaces';
import { BinService } from '../../services/bin.service';
import { Observable, take } from 'rxjs';

@Component({
  selector: 'app-bin',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bin.component.html',
  styleUrl: './bin.component.css'
})
export class BinComponent implements OnInit {
  @Input() show: boolean = false;
  @Output() close = new EventEmitter<void>();
  @Output() itemRestored = new EventEmitter<{ id: number; type: 'task' | 'pad' }>();

  items$: Observable<BinItem[]>;
  selectedId: { id: number; type: 'task' | 'pad' } | null = null;
  confirmingDeleteId: { id: number; type: 'task' | 'pad' } | null = null;
  confirmingRestoreId: { id: number; type: 'task' | 'pad' } | null = null;
  confirmingClearAll: boolean = false;

  constructor(private binService: BinService) {
    this.items$ = this.binService.binItems$;
  }

  ngOnInit() {
    this.binService.loadBinItems();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (!this.show) return;

    if (event.key === "Escape") {
      if (this.confirmingDeleteId || this.confirmingRestoreId || this.confirmingClearAll) {
        this.confirmingDeleteId = null;
        this.confirmingRestoreId = null;
        this.confirmingClearAll = false;
        event.preventDefault();
      } else {
        this.close.emit();
      }
      return;
    }

    if (this.confirmingClearAll) {
      if (event.key === "Enter") {
        this.clearBin();
        event.preventDefault();
      }
      return;
    }

    this.items$.pipe(take(1)).subscribe(items => {
      if (items.length === 0) return;

      let currentIndex = items.findIndex(
        (n) => n.id === this.selectedId?.id && n.type === this.selectedId?.type
      );

      // Actions on selected item
      if (this.selectedId) {
        if (event.ctrlKey && event.key.toLowerCase() === 'r') {
          this.confirmingRestoreId = this.selectedId;
          event.preventDefault();
          return;
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'd') {
          this.confirmingDeleteId = this.selectedId;
          event.preventDefault();
          return;
        }
        if (event.key === "Enter") {
          if (this.confirmingRestoreId) {
            this.restoreItem(this.selectedId.id, this.selectedId.type);
          } else if (this.confirmingDeleteId) {
            this.deleteItem(this.selectedId.id, this.selectedId.type);
          } else {
            this.confirmingRestoreId = this.selectedId;
          }
          event.preventDefault();
          return;
        }
      }

      // Bulk clear
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c') {
        this.confirmingClearAll = true;
        event.preventDefault();
        return;
      }

      // Navigation
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = (currentIndex + 1) % items.length;
        this.selectItem(items[nextIndex].id, items[nextIndex].type);
        this.scrollSelectedIntoView();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prevIndex = (currentIndex - 1 + items.length) % items.length;
        this.selectItem(items[prevIndex].id, items[prevIndex].type);
        this.scrollSelectedIntoView();
      }
    });
  }

  private scrollSelectedIntoView() {
    setTimeout(() => {
      const element = document.querySelector(".bin-item.selected");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 10);
  }

  selectItem(id: number, type: 'task' | 'pad') {
    this.selectedId = { id, type };
    this.confirmingDeleteId = null;
    this.confirmingRestoreId = null;
  }

  async restoreItem(id: number, type: 'task' | 'pad') {
    await this.binService.restoreItem({ id, type });
    this.itemRestored.emit({ id, type });
    this.confirmingRestoreId = null;
    this.selectedId = null;
  }

  async deleteItem(id: number, type: 'task' | 'pad') {
    await this.binService.permanentDeleteItem({ id, type });
    this.confirmingDeleteId = null;
    this.selectedId = null;
  }

  async clearBin() {
    await this.binService.clearBin();
    this.confirmingClearAll = false;
    this.selectedId = null;
  }

  formatContent(content: string): string {
    return content || '';
  }

  formatDate(timestamp: string): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
