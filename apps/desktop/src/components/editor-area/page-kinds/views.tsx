import { lazy, Suspense } from "react";
import { EditorPane } from "../editor-pane";
import { DocumentFooter } from "../document-footer";
import { NewTabPage } from "../new-tab-page";
import { SettingsPanel } from "@/components/settings-panel";
import { SpacePage } from "@/components/spaces/space-page";
import type { Location } from "./index";
import type { BookLocation } from "./book";
import type { FileLocation } from "./file";
import type { LauncherLocation } from "./launcher";
import type { SettingsLocation } from "./settings";
import type { SpaceLocation } from "./space";
import type { PageKindView } from "./types";

/**
 * View registry — maps each page kind to its React tab body (and optional
 * footer chrome). Kept separate from the behavior registry (`./index`) so the
 * editor UI tree is imported only by the renderer that mounts tabs, never by
 * the data/serialization layer (stores, hooks). Without this split, importing
 * the registry to (de)serialize a location dragged the whole editor UI into
 * the stores and produced import cycles. Register a kind's view here alongside
 * its behavior module.
 */
// `file` needs a small adapter because EditorPane is keyed by `path`, not by
// the location object; `launcher`/`settings` reference their components
// directly (extra props are ignored), keeping this file to a single component
// definition.
// Page-kind view registry: exports the pageKindView resolver alongside the file-tab adapter component; not a Fast-Refresh component surface.
// eslint-disable-next-line react-doctor/only-export-components
const FileTabBody = ({
  location,
  isActive,
  inColumn,
  isShown,
}: {
  location: FileLocation;
  isActive: boolean;
  inColumn: boolean;
  isShown: boolean;
}) => <EditorPane path={location.path} isActive={isActive} inColumn={inColumn} isShown={isShown} />;

// The reader (and pdf.js / fflate with it) loads only when a book tab mounts.
const BookReader = lazy(() => import("@/components/book-reader/book-reader"));
// eslint-disable-next-line react-doctor/only-export-components
const BookTabBody = (props: {
  location: BookLocation;
  isActive: boolean;
  inColumn: boolean;
  isShown: boolean;
}) => (
  <Suspense fallback={null}>
    <BookReader {...props} />
  </Suspense>
);

const views = {
  file: {
    Component: FileTabBody,
    renderFooter: (l) => <DocumentFooter filePath={l.path} />,
  } satisfies PageKindView<FileLocation>,
  launcher: {
    Component: NewTabPage,
  } satisfies PageKindView<LauncherLocation>,
  settings: {
    Component: SettingsPanel,
  } satisfies PageKindView<SettingsLocation>,
  book: {
    Component: BookTabBody,
  } satisfies PageKindView<BookLocation>,
  space: {
    Component: SpacePage,
  } satisfies PageKindView<SpaceLocation>,
} as const;

/** Resolve a location to its registered view. Throws on an unknown kind —
 *  always a programmer error, mirroring `pageKind` in `./index`. */
export function pageKindView(location: Location): PageKindView {
  const view = views[location.kind as keyof typeof views];
  if (!view) throw new Error(`No view registered for page kind: ${location.kind}`);
  return view as PageKindView;
}
