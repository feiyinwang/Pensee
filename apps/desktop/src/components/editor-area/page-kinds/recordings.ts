import { definePageKind } from "./types";

export type RecordingsLocation = { kind: "recordings" };

// Every take in Recordings/ (SPECs/talk-notes-spec.md#recordings). The view
// (RecordingsPage) is registered in `./views`.
export const recordingsKind = definePageKind<"recordings", RecordingsLocation>({
  kind: "recordings",
  title: () => "Recordings",
  description: "Every recording in the vault",
});
