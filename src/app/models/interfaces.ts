export interface Note {
  id: number;
  content: string;
  timestamp: string;
  is_pinned: boolean;
  is_deleted: boolean;
}

export interface Pad {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  is_open: boolean;
  is_active: boolean;
  tab_index: number;
}

export interface BinItem {
  id: number;
  type: 'task' | 'pad';
  content: string;
  timestamp: string;
}

export type AuthStatus = 'SetupRequired' | 'Locked' | 'Unlocked' | 'Checking';
