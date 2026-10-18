import type { CSSProperties } from "react";
import { Badge } from "@/components/arc/badge/badge";
import {
  statusLabel,
  statusTone,
  TONE_COLOR,
  type StatusColumn,
  type TagTone,
} from "@/lib/projects";
import styles from "./project-tag.module.css";

// A project's tags, as the Projects board draws them (SPECs/project-views-spec.md),
// and wherever else a project shows (Add to Projects' popup).

/** A tag: Arc's badge as a neutral pill, its meaning in a coloured dot. */
export function Tag({ tone, children }: { tone: TagTone; children: string }) {
  return (
    <Badge size="sm" className={styles.tag} style={{ "--tag": TONE_COLOR[tone] } as CSSProperties}>
      {children}
    </Badge>
  );
}

export function StatusTag({ status, columns }: { status: string; columns: StatusColumn[] }) {
  const tone = statusTone(status);
  if (tone === null) return <span className={styles.noStatus}>No status</span>;
  return <Tag tone={tone}>{statusLabel(columns, status)}</Tag>;
}
