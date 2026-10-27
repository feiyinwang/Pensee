import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, Copy, MonitorPlay, PenLine, Podcast } from "lucide-react";
import * as tauri from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { AGENT_PROVIDERS, type AgentProviderId } from "@/lib/agent-models";
import {
  refreshClaudeAccount,
  signInClaudeFromSettings,
  useClaudeSignInStore,
} from "@/stores/claude-sign-in-store";
import { FeatureCarousel } from "./feature-carousel";
import {
  finishOnboarding,
  goToScreen,
  maybeStartOnboarding,
  startPractice,
  useOnboardingStore,
  type OnboardingScreen,
  type SampleId,
} from "./onboarding-store";
import { PracticeGuide } from "./practice-guide";
import { SAMPLES, SAMPLES_FOLDER, openSample } from "./samples";
import "./onboarding.css";
import { IS_MAC, keyLabel } from "@/lib/platform";

/** First-run onboarding (SPECs/onboarding-spec.md): one question per screen,
 *  then a practice loop in the real app, then the features carousel. */
export function Onboarding() {
  const open = useOnboardingStore((s) => s.open);
  const screen = useOnboardingStore((s) => s.screen);

  useEffect(() => {
    void maybeStartOnboarding(useWorkspaceStore.getState().root);
  }, []);

  if (!open) return null;
  if (screen === "practice") return <PracticeGuide />;
  return createPortal(
    <div className="onb" role="dialog" aria-modal="true" aria-label="Welcome to Pensée">
      {screen === "notes" && <NotesScreen />}
      {screen === "ai" && <AiScreen />}
      {screen === "try" && <TryScreen />}
      {screen === "more" ? <MoreScreen /> : <Dots screen={screen} />}
    </div>,
    document.body,
  );
}

const DOT_SCREENS: OnboardingScreen[] = ["notes", "ai", "try", "more"];

function Dots({ screen }: { screen: OnboardingScreen }) {
  return (
    <div className="onb-dots" aria-hidden="true">
      {DOT_SCREENS.map((s) => (
        <i key={s} data-on={s === screen || undefined} />
      ))}
    </div>
  );
}

/** A screen's column: its question, its choices, and the keys that move
 *  between them. ↑ ↓ move the filled choice; ↵ runs it (it's focused). */
function Question({
  title,
  sub,
  mark,
  children,
  onEscape,
  keys = true,
}: {
  title: string;
  sub?: ReactNode;
  mark?: boolean;
  children: ReactNode;
  onEscape?: () => void;
  keys?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-choice]")?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      onEscape();
      return;
    }
    // ↵ runs the filled (focused) choice, whatever had the key first.
    if (event.key === "Enter" && (event.target as HTMLElement).matches("[data-choice]")) {
      event.preventDefault();
      (event.target as HTMLElement).click();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const choices = [...(ref.current?.querySelectorAll<HTMLElement>("[data-choice]") ?? [])];
    if (!choices.length) return;
    event.preventDefault();
    const at = choices.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    choices[(at + step + choices.length) % choices.length]!.focus();
  };

  return (
    <div className="onb-col" ref={ref} onKeyDown={onKeyDown}>
      {mark && (
        <svg className="onb-mark" viewBox="-30 10 87 80" fill="currentColor" aria-hidden="true">
          <path d="M-28 12H35V68A20 20 0 0 0 55 88H29V17H21V88H0V40A28 28 0 0 0 -28 12Z" />
        </svg>
      )}
      <div className="onb-head">
        <h1 className="onb-title">{title}</h1>
        {sub && <p className="onb-sub">{sub}</p>}
      </div>
      {children}
      {keys && (
        <div className="onb-keys" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> choose
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
        </div>
      )}
    </div>
  );
}

/** A stacked button; the focused one is filled and shows ↵. */
function Choice({
  children,
  meta,
  icon,
  onSelect,
  disabled,
}: {
  children: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="onb-choice"
      data-choice=""
      onClick={onSelect}
      disabled={disabled}
    >
      {icon}
      <span className="onb-choice-label">{children}</span>
      <kbd className="onb-enter" aria-hidden="true">
        ↵
      </kbd>
      {meta && <span className="onb-meta">{meta}</span>}
    </button>
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

/* ---------------------------------------------------------- 1. your notes */

function NotesScreen() {
  const [vaults, setVaults] = useState<tauri.ObsidianVault[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    tauri
      .obsidianVaults()
      .then((found) => live && setVaults(found))
      .catch((e: unknown) => {
        console.error("[onboarding] Couldn't read Obsidian's vaults:", e);
        if (live) setVaults([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const open = async (path: string | null) => {
    if (!path) return;
    setError(null);
    try {
      await useWorkspaceStore.getState().openWorkspace(path);
      goToScreen("ai");
    } catch (e) {
      setError(errorText(e));
    }
  };
  const pickFolder = () => void tauri.pickWorkspace().then(open);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((IS_MAC ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        event.stopPropagation();
        pickFolder();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (vaults === null) return null;
  return (
    <Question
      mark
      title="Open your second brain."
      sub="Pensée works on a folder of Markdown files. An Obsidian vault opens as it is."
    >
      {vaults.map((vault) => (
        <Choice
          key={vault.path}
          onSelect={() => void open(vault.path)}
          meta={`${vault.notes >= 10_000 ? "10,000+" : vault.notes.toLocaleString()} notes`}
        >
          Open {vault.name}
        </Choice>
      ))}
      <Choice onSelect={pickFolder} meta={keyLabel("⌘O")}>
        Open a folder…
      </Choice>
      <div className="onb-alt">
        <button
          type="button"
          className="onb-text-button"
          onClick={() =>
            void tauri.createStarterFolder().then(open, (e: unknown) => setError(errorText(e)))
          }
        >
          Start a new folder in Documents
        </button>
      </div>
      {error && <p className="onb-error">{error}</p>}
    </Question>
  );
}

/* ---------------------------------------------------------- 2. which AI */

/** How to install each CLI, for when it isn't on this Mac. */
const INSTALL: Record<AgentProviderId, string> = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  codex: "npm install -g @openai/codex",
};

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="onb-code">
      <code>{command}</code>
      <button
        type="button"
        className="onb-icon-button"
        aria-label="Copy the install command"
        onClick={() =>
          void navigator.clipboard.writeText(command).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          })
        }
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}

/** Pensée needs Claude Code or Codex: each one found gets a button (Use it,
 *  or Sign in), the ones missing show how to install them. */
function AiScreen() {
  const [installed, setInstalled] = useState<Record<AgentProviderId, boolean> | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = useClaudeSignInStore((s) => s.accounts);
  const accountErrors = useClaudeSignInStore((s) => s.accountErrors);
  const signingIn = useClaudeSignInStore((s) =>
    s.open && s.phase === "waiting" ? s.provider : null,
  );

  const check = () => {
    setInstalled(null);
    void Promise.all(
      AGENT_PROVIDERS.map((provider) =>
        tauri.claudeInstalled(provider.id).then((found) => {
          if (found) void refreshClaudeAccount(provider.id);
          return [provider.id, found] as const;
        }),
      ),
    ).then((found) => setInstalled(Object.fromEntries(found) as Record<AgentProviderId, boolean>));
  };
  useEffect(check, []);

  const next = () => goToScreen("try");
  const use = (provider: AgentProviderId) => {
    setError(null);
    useSettingsStore
      .getState()
      .setSetting("agent.provider", provider, "global")
      .then(next, (e: unknown) => setError(errorText(e)));
  };

  const found = AGENT_PROVIDERS.filter((provider) => installed?.[provider.id]);
  const missing = AGENT_PROVIDERS.filter((provider) => installed && !installed[provider.id]);
  // Still checking; a failed check shows its reason instead (below).
  const checking =
    installed === null ||
    found.some((provider) => accounts[provider.id] === null && !accountErrors[provider.id]);
  if (checking) return null;
  // The one already chosen leads, so a returning writer's ↵ keeps it.
  const chosen = useSettingsStore.getState().getSetting("agent.provider");
  found.sort((a, b) => Number(b.id === chosen) - Number(a.id === chosen));
  // Signed in first: that's the one ↵ should take.
  found.sort(
    (a, b) => Number(accounts[b.id] === "signed-in") - Number(accounts[a.id] === "signed-in"),
  );
  const showMissing = missing.length > 0 && (found.length === 0 || more);

  return (
    <Question
      title="Which AI should Pensée use?"
      sub="Pensée needs Claude or ChatGPT, on the plan you already have (ChatGPT Free works). Only the lines you ask about are sent."
    >
      {found.map((provider) =>
        accounts[provider.id] === "signed-in" ? (
          <Choice key={provider.id} onSelect={() => use(provider.id)} meta={provider.name}>
            Use {provider.plan}
          </Choice>
        ) : accounts[provider.id] === null ? (
          <p key={provider.id} className="onb-error">
            {accountErrors[provider.id]}
          </p>
        ) : (
          <Choice
            key={provider.id}
            onSelect={() => signInClaudeFromSettings(provider.id)}
            meta={signingIn === provider.id ? "finish in your browser" : "signed out"}
          >
            Sign in to {provider.plan}
          </Choice>
        ),
      )}
      {showMissing && (
        <div className="onb-panel">
          {missing.map((provider) => (
            <Fragment key={provider.id}>
              <p>
                <b>{provider.plan}</b> needs {provider.name}, which isn't on this Mac yet. Install
                it in Terminal, then check again.
              </p>
              <CopyCommand command={INSTALL[provider.id]} />
            </Fragment>
          ))}
          <Choice onSelect={check}>Check again</Choice>
        </div>
      )}
      {error && <p className="onb-error">{error}</p>}
      <div className="onb-alt">
        {missing.length > 0 && found.length > 0 && (
          <button type="button" className="onb-text-button" onClick={() => setMore(!more)}>
            {more ? "Fewer options" : "Other options"}
          </button>
        )}
        <button type="button" className="onb-text-button" onClick={next}>
          Skip for now
        </button>
      </div>
    </Question>
  );
}

/* ---------------------------------------------------------- 3. try it */

const SAMPLE_ICONS: Record<SampleId, ReactNode> = {
  video: <MonitorPlay size={16} aria-hidden className="onb-icon" />,
  podcast: <Podcast size={16} aria-hidden className="onb-icon" />,
  book: <BookOpen size={16} aria-hidden className="onb-icon" />,
  write: <PenLine size={16} aria-hidden className="onb-icon" />,
};

function TryScreen() {
  const [busy, setBusy] = useState<SampleId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useWorkspaceStore((s) => s.root);

  const pick = async (id: SampleId) => {
    if (!root || busy) return;
    setBusy(id);
    setError(null);
    try {
      startPractice(id, await openSample(root, id));
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  return (
    <Question
      title="Pick something to try Pensée on."
      sub={`Each opens as a note in ${SAMPLES_FOLDER}. Delete it any time.`}
      onEscape={() => goToScreen("ai")}
    >
      {(Object.keys(SAMPLES) as SampleId[]).map((id) => (
        <Choice
          key={id}
          icon={SAMPLE_ICONS[id]}
          onSelect={() => void pick(id)}
          disabled={busy !== null}
          meta={busy === id ? "Opening…" : SAMPLES[id].meta}
        >
          {SAMPLES[id].label}
        </Choice>
      ))}
      {error && <p className="onb-error">{error}</p>}
    </Question>
  );
}

/* ---------------------------------------------------------- 4. there's more */

function MoreScreen() {
  const tried = useOnboardingStore((s) => s.sample);
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => doneRef.current?.focus(), []);
  const fitRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fit = () =>
      fitRef.current?.style.setProperty(
        "--onb-fit",
        String(Math.min(1, (window.innerWidth - 32) / 1100, (window.innerHeight - 24) / 800)),
      );
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="onb-fit" ref={fitRef}>
      <div className="onb-more">
        <div className="onb-head">
          <h1 className="onb-title">There's more when you need it.</h1>
        </div>
        <FeatureCarousel tried={tried} />
        <button type="button" className="onb-done" ref={doneRef} onClick={finishOnboarding}>
          Start writing <kbd>↵</kbd>
        </button>
      </div>
    </div>
  );
}
