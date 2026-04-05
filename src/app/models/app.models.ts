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
  file_path: string | null;
  isDirty?: boolean;
}

export interface PadVersion {
  id: number;
  pad_id: number;
  content: string;
  timestamp: string;
  label: string | null;
}

export type AuthStatus = "SetupRequired" | "Locked" | "Unlocked" | "Checking";

export interface AppShortcut {
  id: string;
  label: string;
  category: string;
  defaultKeyStr: string;
  currentKeyStr: string;
}

export interface BinItem {
  id: number;
  type: "pad";
  content: string;
  timestamp: string;
}
