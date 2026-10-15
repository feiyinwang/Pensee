import { AppLayout } from "./components/app-layout";
import { ClaudeSignIn } from "./components/claude-sign-in";
import { CommandPalette } from "./components/command-palette";
import { Composer } from "./components/composer";
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
// Bodoni Moda, the brand's Didone, bundled so titles never wait on the network.
// The `opsz` build keeps the optical-size axis: hairlines thin out as titles grow.
import "@fontsource-variable/bodoni-moda/opsz.css";
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
      <ClaudeSignIn />
    </>
  );
}

export default App;
