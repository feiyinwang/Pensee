import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "@/stores/workspace-store";
import * as editorApi from "@/hooks/editor-api";
import { formatClock } from "@/lib/talk/clock";
import { type Segment, readTranscript } from "@/lib/talk/transcript";
import "./recordings-page.css";

// Recordings (SPECs/talk-notes-spec.md#recordings): every take in
// Recordings/, newest first, with the note it's in. Choosing one shows its
// player and the transcript its note holds, and opens the note.

interface RecordingFile {
  file: string;
  bytes: number;
  modified: number;
}

interface MentioningLine {
  path: string;
  stem: string;
  line: number;
  text: string;
}

const dateOf = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function Player({
  src,
  name,
  at,
}: {
  src: string;
  name: string;
  at: { seconds: number; n: number } | null;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState({ now: 0, total: 0, playing: false });
  useEffect(() => {
    const el = audio.current;
    if (!el || !at) return;
    el.currentTime = at.seconds;
    void el.play();
  }, [at]);
  const sync = () => {
    const el = audio.current;
    if (el)
      setTime({
        now: el.currentTime,
        total: Number.isFinite(el.duration) ? el.duration : 0,
        playing: !el.paused,
      });
  };
  return (
    <span
      className="cm-audio-embed recordings-player"
      data-playing={time.playing ? "" : undefined}
      role="group"
      aria-label={`Recording ${name}`}
    >
      <button
        type="button"
        className="cm-audio-embed-play"
        aria-label={time.playing ? "Pause" : "Play"}
        onClick={() => {
          const el = audio.current;
          if (el) void (el.paused ? el.play() : el.pause());
        }}
      />
      <span className="cm-audio-embed-middle">
        <span className="cm-audio-embed-name">{name}</span>
        <span
          className="cm-audio-embed-bar"
          role="slider"
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(time.total)}
          aria-valuenow={Math.round(time.now)}
          tabIndex={0}
          onPointerDown={(e) => {
            const el = audio.current;
            if (!el || !time.total) return;
            const r = e.currentTarget.getBoundingClientRect();
            el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * time.total;
          }}
        >
          <span
            className="cm-audio-embed-fill"
            style={{ transform: `scaleX(${time.total ? time.now / time.total : 0})` }}
          />
        </span>
      </span>
      <span className="cm-audio-embed-time">
        {time.total
          ? `${formatClock(time.now)} / ${formatClock(time.total)}`
          : formatClock(time.now)}
      </span>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={sync}
        onTimeUpdate={sync}
        onPlay={sync}
        onPause={sync}
        onEnded={sync}
      />
    </span>
  );
}

export function RecordingsPage() {
  const root = useWorkspaceStore((s) => s.root);
  const [files, setFiles] = useState<RecordingFile[] | null>(null);
  const [notes, setNotes] = useState<Map<string, MentioningLine>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ engine: string; segments: Segment[] } | null>(
    null,
  );
  const [at, setAt] = useState<{ seconds: number; n: number } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      invoke<RecordingFile[]>("list_recordings"),
      invoke<MentioningLine[]>("find_lines_mentioning", {
        terms: ["Recordings/"],
        exclude: null,
        limit: 100,
      }),
    ])
      .then(([list, lines]) => {
        if (!live) return;
        setFiles(list);
        const byFile = new Map<string, MentioningLine>();
        for (const f of list) {
          const line = lines.find((l) => l.text.includes(`![[${f.file}]]`));
          if (line) byFile.set(f.file, line);
        }
        setNotes(byFile);
        setSelected((s) => s ?? list[0]?.file ?? null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => void (live = false);
  }, [root]);

  const note = selected ? notes.get(selected) : undefined;
  useEffect(() => {
    setTranscript(null);
    setAt(null);
    if (!selected || !note) return;
    let live = true;
    invoke<{ content: string }>("read_file", { path: note.path })
      .then((r) => live && setTranscript(readTranscript(r.content, selected)))
      .catch(() => live && setTranscript(null));
    return () => void (live = false);
  }, [selected, note]);

  const chosen = useMemo(() => files?.find((f) => f.file === selected), [files, selected]);

  return (
    <div className="recordings-page">
      <div className="recordings-column">
        <h1 className="recordings-title">Recordings</h1>
        <p className="recordings-meta">
          Every take is an audio file in Recordings/ in your vault. Its transcript is in the note
          you made it in, and here.
        </p>
        {error ? (
          <p className="recordings-empty">Recordings couldn't be listed: {error}</p>
        ) : files === null ? null : files.length === 0 ? (
          <p className="recordings-empty">
            No recordings yet. Press Record at the bottom of a note to make one.
          </p>
        ) : (
          <div className="recordings-split">
            <ul className="recordings-list" aria-label="Recordings">
              {files.map((f) => (
                <li key={f.file}>
                  <button
                    type="button"
                    className="recordings-row"
                    aria-current={f.file === selected ? "true" : undefined}
                    onClick={() => setSelected(f.file)}
                  >
                    <span className="recordings-row-name">
                      {notes.get(f.file)?.stem ?? f.file.slice("Recordings/".length)}
                    </span>
                    <span className="recordings-row-sub">{dateOf(f.modified)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {chosen && root && (
              <div className="recordings-detail">
                <Player
                  src={convertFileSrc(`${root}/${chosen.file}`)}
                  name={chosen.file.slice("Recordings/".length)}
                  at={at}
                />
                <p className="recordings-note">
                  {note ? (
                    <>
                      In{" "}
                      <button
                        type="button"
                        className="recordings-link"
                        onClick={() => void editorApi.openLinkedPage(note.path)}
                      >
                        {note.stem}
                      </button>
                    </>
                  ) : (
                    "Not in any note."
                  )}
                </p>
                {transcript ? (
                  <section aria-label="Transcript">
                    <h2 className="recordings-h">Transcript · {transcript.engine}</h2>
                    <ol className="recordings-transcript">
                      {transcript.segments.map((s, n) => (
                        <li key={n}>
                          <button
                            type="button"
                            className="recordings-time"
                            onClick={() => setAt({ seconds: s.start, n: Date.now() })}
                          >
                            {formatClock(s.start)}
                          </button>
                          {s.text}
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : (
                  note && <p className="recordings-empty">This take has no transcript yet.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
