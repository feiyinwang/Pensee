import type { ReactNode } from "react";
import { avatar } from "../../lib/media";

/** Sample board for the kanban block. Replace with cards from your issue tracker. */

export interface KanbanColumn { id: string; name: string; /** Work in progress limit. The column warns once it holds more cards. */ limit?: number; /** Pensée patch: shown in the column head in place of name (name still labels it for screen readers). */ label?: ReactNode; /** Pensée patch: cards of this column left out of `cards`, still counted in its head. */ hidden?: number }
export interface KanbanPerson { id: string; name: string; avatar?: string }
export interface KanbanChecklistItem { id: string; text: string; done: boolean }
export interface KanbanCard {
  id: string;
  title: string;
  column: string;
  assignee: string;
  label?: string;
  due?: string;
  points?: number;
  description?: string;
  checklist?: KanbanChecklistItem[];
  /** Pensée patch: extra content at the start of the card's meta row, such as tags. */
  meta?: ReactNode;
}

export const sampleColumns: KanbanColumn[] = [
  { id: "backlog", name: "Backlog" },
  { id: "progress", name: "In progress", limit: 3 },
  { id: "review", name: "In review", limit: 2 },
  { id: "done", name: "Done" },
];

export const samplePeople: KanbanPerson[] = [
  { id: "emma", name: "Emma Collins", avatar: avatar("emma-collins") },
  { id: "marcus", name: "Marcus Johnson", avatar: avatar("marcus-johnson") },
  { id: "chloe", name: "Chloe Nguyen", avatar: avatar("chloe-nguyen") },
  { id: "daniel", name: "Daniel Kim", avatar: avatar("daniel-kim") },
];

const list = (...items: [string, boolean][]) => items.map(([text, done], index) => ({ id: `c${index}`, text, done }));

export const sampleCards: KanbanCard[] = [
  { id: "BIL-142", title: "Proration preview when seats change mid-cycle", column: "backlog", assignee: "daniel", label: "Billing", due: "Oct 2", points: 5, description: "Show the prorated amount before a seat change is confirmed, using the upcoming invoice endpoint.", checklist: list(["Upcoming invoice call", false], ["Preview row in seat dialog", false], ["Copy review", false]) },
  { id: "BIL-151", title: "Dunning emails for failed renewals", column: "backlog", assignee: "chloe", label: "Lifecycle", due: "Oct 6", points: 3 },
  { id: "BIL-155", title: "Tax ID field for EU customers", column: "backlog", assignee: "marcus", label: "Billing", points: 2 },
  { id: "BIL-160", title: "Empty state for invoices list", column: "backlog", assignee: "emma", label: "Design", points: 1 },
  { id: "BIL-128", title: "Usage meter on the billing page", column: "progress", assignee: "emma", label: "Design", due: "Sep 26", points: 3, description: "Meter per metered feature with the current period, the included amount, and a forecast marker.", checklist: list(["Meter component", true], ["Forecast marker", true], ["Dark mode pass", false], ["Handoff notes", false]) },
  { id: "BIL-133", title: "Webhook retries for invoice.paid", column: "progress", assignee: "daniel", label: "API", due: "Sep 25", points: 5, checklist: list(["Idempotency keys", true], ["Backoff schedule", false]) },
  { id: "BIL-137", title: "Coupon stacking rules", column: "progress", assignee: "marcus", label: "Billing", due: "Sep 30", points: 3 },
  { id: "BIL-119", title: "Annual plan switch keeps credits", column: "review", assignee: "chloe", label: "Billing", due: "Sep 24", points: 3, checklist: list(["Credit carry over", true], ["Receipt line", true], ["QA on staging", false]) },
  { id: "BIL-124", title: "Invoice PDF uses workspace logo", column: "review", assignee: "emma", label: "Design", points: 2 },
  { id: "BIL-102", title: "Migrate prices to the new catalog", column: "done", assignee: "daniel", label: "API", points: 8 },
  { id: "BIL-108", title: "Billing settings information architecture", column: "done", assignee: "emma", label: "Design", points: 3 },
  { id: "BIL-111", title: "Payment method update flow", column: "done", assignee: "marcus", label: "Billing", points: 5 },
];
