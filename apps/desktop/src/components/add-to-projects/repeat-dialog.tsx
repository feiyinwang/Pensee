import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { ensureArcTokens } from "@/components/editor-area/board/arc-tokens";
import { StatusTag } from "@/components/spaces/project-tag";
import { answerRepeat, closeRepeats, useRepeatStore } from "./repeat-store";
import "./repeat-dialog.css";

ensureArcTokens();

/** One question at a time: the writer's line, then the project it may be as
 *  its card, then the two answers. Nothing else: the answers say what each
 *  does, so there is no subtitle and no close button (Esc and a click
 *  outside still close it, as Same project). */
export default function RepeatDialog() {
  const questions = useRepeatStore((s) => s.questions);
  const at = useRepeatStore((s) => s.answers.length);
  const question = questions[at];
  if (!question) return null;
  const { existing } = question;
  return (
    <Dialog open onOpenChange={(open) => !open && closeRepeats()}>
      <DialogContent
        className="repeat-dialog"
        title="Already a project?"
        description={questions.length > 1 ? `${at + 1} of ${questions.length}` : undefined}
        // The answer starts on Same project, which makes nothing.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>("[data-repeat-same]")?.focus();
        }}
      >
        <p className="repeat-line">{question.line}</p>
        <div className="repeat-card">
          <div className="repeat-card-top">
            <span className="repeat-card-title">{existing.name}</span>
            <StatusTag status={existing.status} columns={existing.columns} />
          </div>
          {existing.excerpt ? <p className="repeat-card-excerpt">{existing.excerpt}</p> : null}
        </div>
        <div className="repeat-actions">
          <Button variant="secondary" onClick={() => answerRepeat("new")}>
            New project
          </Button>
          <Button variant="primary" data-repeat-same="" onClick={() => answerRepeat("same")}>
            Same project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
