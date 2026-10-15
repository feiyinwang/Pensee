import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  closeClaudeSignIn,
  startClaudeSignIn,
  submitClaudeSignInCode,
  useClaudeSignInStore,
} from "@/stores/claude-sign-in-store";
import "./claude-sign-in.css";

// The "Sign in to Claude" popup (SPECs/claude-sign-in-spec.md), opened when a
// pen or Agent request fails because Claude Code is signed out.
//
// It floats over the window without a backdrop, so the app stays usable behind
// it. A click outside it goes to the app and leaves it open: coming back from
// the browser, the first click on the window must not cancel the sign-in.
export function ClaudeSignIn() {
  const open = useClaudeSignInStore((s) => s.open);
  if (!open) return null;
  return createPortal(<SignInCard />, document.body);
}

function SignInCard() {
  const phase = useClaudeSignInStore((s) => s.phase);
  const error = useClaudeSignInStore((s) => s.error);
  const url = useClaudeSignInStore((s) => s.url);
  const [code, setCode] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  // Keys go to the card, not the note behind it.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const primary =
    phase === "done"
      ? { label: "Done", run: closeClaudeSignIn }
      : phase === "failed"
        ? { label: "Try again", run: () => void startClaudeSignIn() }
        : phase === "idle"
          ? { label: "Sign in", run: () => void startClaudeSignIn() }
          : null;
  const secondary = phase === "waiting" ? "Cancel" : phase === "done" ? null : "Not now";

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeClaudeSignIn();
    } else if (event.key === "Enter" && primary && event.target === event.currentTarget) {
      event.preventDefault();
      event.stopPropagation();
      primary.run();
    }
  }

  const title = phase === "done" ? "Signed in" : "Claude is signed out";
  const body =
    phase === "done"
      ? "Run it again."
      : phase === "waiting"
        ? "Finish signing in in your browser, then come back here."
        : "Organize, the pen and the Agent use Claude Code on this Mac. Sign in to use them again.";

  return (
    <div className="claude-sign-in-layer">
      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby="claude-sign-in-title"
        tabIndex={-1}
        className="claude-sign-in surface-card surface-card-opaque popover-outline"
        onKeyDown={onKeyDown}
      >
        <h2 id="claude-sign-in-title" className="claude-sign-in-title">
          {title}
        </h2>
        {phase === "failed" && error ? (
          <p className="claude-sign-in-body claude-sign-in-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="claude-sign-in-body">{body}</p>
        )}

        {/* Always laid out, shown only while waiting: the card keeps one size
            and its buttons stay put from state to state. */}
        <form
          className="claude-sign-in-code"
          data-shown={phase === "waiting" || undefined}
          inert={phase !== "waiting"}
          aria-hidden={phase !== "waiting"}
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void submitClaudeSignInCode(code);
          }}
        >
          <input
            className="claude-sign-in-input"
            value={code}
            placeholder="Browser showed a code? Paste it here"
            aria-label="Code from the browser"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="submit" className="claude-sign-in-button" disabled={!code.trim()}>
            Continue
          </button>
        </form>

        <div className="claude-sign-in-actions">
          {phase === "waiting" && url ? (
            <button
              type="button"
              className="claude-sign-in-link"
              onClick={() =>
                void openUrl(url).catch((error: unknown) =>
                  console.error("[sign-in] Couldn't open the sign-in page:", error),
                )
              }
            >
              Open the sign-in page again
            </button>
          ) : null}
          <span className="claude-sign-in-spacer" />
          {secondary ? (
            <button type="button" className="claude-sign-in-button" onClick={closeClaudeSignIn}>
              {secondary}
              <kbd className="claude-sign-in-kbd">Esc</kbd>
            </button>
          ) : null}
          {primary ? (
            <button
              type="button"
              className="claude-sign-in-button claude-sign-in-button--primary"
              onClick={primary.run}
            >
              {primary.label}
              <kbd className="claude-sign-in-kbd">↵</kbd>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
