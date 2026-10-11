// Mirrors `AppleBook` / `AppleBookHighlight` in `src-tauri/src/commands/apple_books.rs`.

export interface AppleBookHighlight {
  /** Apple Books' annotation UUID. */
  id: string;
  text: string;
  note: string | null;
  /** Unix seconds. */
  createdAt: number;
}

export interface AppleBook {
  assetId: string;
  title: string;
  author: string | null;
  highlights: AppleBookHighlight[];
}
