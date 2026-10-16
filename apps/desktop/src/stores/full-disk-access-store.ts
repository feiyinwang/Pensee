import { create } from "zustand";

// The Full Disk Access guide (SPECs/apple-books-highlights-spec.md): opened
// when the automatic Apple Books import finds Pensée without Full Disk Access.
// `granted` flips once Pensée has it, so the guide can say it's done.

interface FullDiskAccessState {
  open: boolean;
  granted: boolean;
}

export const useFullDiskAccessStore = create<FullDiskAccessState>(() => ({
  open: false,
  granted: false,
}));

export function openFullDiskAccessGuide() {
  useFullDiskAccessStore.setState({ open: true, granted: false });
}

export function closeFullDiskAccessGuide() {
  useFullDiskAccessStore.setState({ open: false });
}

export function markFullDiskAccessGranted() {
  useFullDiskAccessStore.setState({ granted: true });
}
