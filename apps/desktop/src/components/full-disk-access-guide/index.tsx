import { useEffect, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Lock } from "lucide-react";
import { syncAppleBooksNow } from "@/hooks/use-apple-books-sync";
import * as tauri from "@/lib/tauri";
import {
  closeFullDiskAccessGuide,
  markFullDiskAccessGranted,
  useFullDiskAccessStore,
} from "@/stores/full-disk-access-store";
import settingsShot from "./full-disk-access-settings.webp";
import "./full-disk-access-guide.css";

// The Full Disk Access guide (SPECs/apple-books-highlights-spec.md). macOS asks
// "access data from other apps" every time Pensée reads Apple Books and never
// keeps the answer; Full Disk Access is the one grant it keeps. The guide shows
// where to give it: a drawn System Settings pane plays the three clicks once,
// numbered like the steps beside it.
//
// It floats like the Claude sign-in popup, but opens by itself (at launch, or
// when Import Highlights is turned on), so it never takes focus from the note
// being written: Esc and ↵ work once it is clicked.

const FULL_DISK_ACCESS_PANE =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

export function FullDiskAccessGuide() {
  const open = useFullDiskAccessStore((s) => s.open);
  if (!open) return null;
  return createPortal(<GuideCard />, document.body);
}

function openPane() {
  void openUrl(FULL_DISK_ACCESS_PANE).catch((error: unknown) =>
    console.error("[full-disk-access] Couldn't open System Settings:", error),
  );
}

function GuideCard() {
  const granted = useFullDiskAccessStore((s) => s.granted);

  // Back from System Settings: check again, and import once it's on.
  useEffect(() => {
    if (granted) return;
    let cancelled = false;
    const check = () => {
      void tauri.hasFullDiskAccess().then((has) => {
        if (cancelled || !has) return;
        markFullDiskAccessGranted();
        void syncAppleBooksNow(false);
      });
    };
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
    };
  }, [granted]);

  const primary = granted
    ? { label: "Done", run: closeFullDiskAccessGuide }
    : { label: "Open Settings", run: openPane };

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeFullDiskAccessGuide();
    } else if (event.key === "Enter" && event.target === event.currentTarget) {
      event.preventDefault();
      event.stopPropagation();
      primary.run();
    }
  }

  return (
    <div className="fda-guide-layer">
      <div
        role="dialog"
        aria-labelledby="fda-guide-title"
        tabIndex={-1}
        className="fda-guide surface-card surface-card-opaque popover-outline"
        onKeyDown={onKeyDown}
      >
        <h2 id="fda-guide-title" className="fda-guide-title">
          {granted ? "Full Disk Access is on" : "Let Pensée read Apple Books"}
        </h2>
        <p className="fda-guide-body">
          {granted
            ? "Pensée is importing your Apple Books highlights now, and macOS won't ask again."
            : "macOS asks each time Pensée reads your highlights. Full Disk Access is the one answer it remembers."}
        </p>

        <SettingsPicture />

        <ol className="fda-guide-steps">
          <li className="fda-guide-step" data-step="1">
            <span>
              Click <b>+</b> under the list.
            </span>
          </li>
          <li className="fda-guide-step" data-step="2">
            <span>
              Choose <b>Pensée</b> in Applications and click <b>Open</b>. It joins the list.
            </span>
          </li>
          <li className="fda-guide-step" data-step="3">
            <span>
              Turn <b>Pensée</b> on, then let macOS quit and reopen it.
            </span>
          </li>
        </ol>

        <p className="fda-guide-private">
          <Lock className="fda-guide-private-icon" aria-hidden="true" />
          Private: Pensée reads your highlights on this Mac and uploads nothing.
        </p>

        <div className="fda-guide-actions">
          {granted ? null : (
            <button type="button" className="fda-guide-button" onClick={closeFullDiskAccessGuide}>
              Not now
              <kbd className="fda-guide-kbd">Esc</kbd>
            </button>
          )}
          <button
            type="button"
            className="fda-guide-button fda-guide-button--primary"
            onClick={primary.run}
          >
            {primary.label}
            <kbd className="fda-guide-kbd">↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

/** System Settings → Privacy & Security → Full Disk Access, a real
 *  screenshot seen through a rounded window (which also trims its corners).
 *  It plays the steps in order, from before Pensée is listed: the pane's
 *  title, a scroll down to the end of the list, a click on +, Pensée joining
 *  the list (the row after it slides down to make room), and Pensée turned
 *  on. Markers 1–3 point at +, Pensée and its switch. The resting styles are
 *  the last frame, so Reduce motion (no animation) shows it at once. */
function SettingsPicture() {
  return (
    <div className="fda-figure" aria-hidden="true">
      <div className="fda-shot">
        <img className="fda-shot-image" src={settingsShot} alt="" draggable={false} />
        {/* Before Pensée is added: its row and the one after it, cleared. */}
        <span className="fda-shot-clear" />
        <span className="fda-shot-slice" data-slice="pensee">
          <img src={settingsShot} alt="" draggable={false} />
        </span>
        <span className="fda-shot-slice" data-slice="after">
          <img src={settingsShot} alt="" draggable={false} />
        </span>
        <span className="fda-figure-switch" />
        <span className="fda-figure-marker" data-step="1">
          1
        </span>
        <span className="fda-figure-marker" data-step="2">
          2
        </span>
        <span className="fda-figure-marker" data-step="3">
          3
        </span>
      </div>
      {/* The macOS pointer. */}
      <svg className="fda-figure-cursor" viewBox="0 0 12 18">
        <path d="M1 1v14l3.6-3.4 2.3 5.2 2.2-1-2.3-5.1H12z" />
      </svg>
    </div>
  );
}
