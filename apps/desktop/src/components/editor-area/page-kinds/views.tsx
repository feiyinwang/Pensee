import { StackedPages } from "../stacked-pages";
import { DocumentFooter } from "../document-footer";
import { NewTabPage } from "../new-tab-page";
import { SettingsPanel } from "@/components/settings-panel";
import type { Location } from "./index";
import type { FileLocation } from "./file";
import type { LauncherLocation } from "./launcher";
import type { SettingsLocation } from "./settings";
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
const views = {
  file: {
    Component: StackedPages,
    renderFooter: (l) => <DocumentFooter filePath={l.path} />,
  } satisfies PageKindView<FileLocation>,
  launcher: {
    Component: NewTabPage,
  } satisfies PageKindView<LauncherLocation>,
  settings: {
    Component: SettingsPanel,
  } satisfies PageKindView<SettingsLocation>,
} as const;

/** Resolve a location to its registered view. Throws on an unknown kind —
 *  always a programmer error, mirroring `pageKind` in `./index`. */
export function pageKindView(location: Location): PageKindView {
  const view = views[location.kind as keyof typeof views];
  if (!view) throw new Error(`No view registered for page kind: ${location.kind}`);
  return view as PageKindView;
}
