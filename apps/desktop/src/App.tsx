import { AppLayout } from "./components/app-layout";
import { CommandPalette } from "./components/command-palette";
import { Composer } from "./components/composer";
import { TelemetryConsentDialog } from "./components/telemetry-consent-dialog";
import { WindowTitle } from "./components/window-title";
import { useIsStartupResolved } from "./hooks/use-workspace";
import { useAppleBooksSync } from "./hooks/use-apple-books-sync";
import { useXBookmarksSync } from "./hooks/use-x-bookmarks-sync";
import { useBookDrop } from "./hooks/use-book-drop";
import { useFileWatcher } from "./hooks/use-file-watcher";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useMenuEvents } from "./hooks/use-menu-events";
import { useOpenDrop } from "./hooks/use-open-drop";
import "./lib/global-recents";
import "./lib/standalone-watch";
import "./App.css";

function App() {
  const isStartupResolved = useIsStartupResolved();

  useFileWatcher();
  useAppleBooksSync();
  useXBookmarksSync();
  useBookDrop();
  useKeyboardShortcuts();
  useMenuEvents();
  useOpenDrop();

  if (!isStartupResolved) {
    return null;
  }

  return (
    <>
      <WindowTitle />
      <AppLayout />
      <CommandPalette />
      <Composer />
      <TelemetryConsentDialog />
    </>
  );
}

export default App;
