import { useEffect } from "react";
import { Badge } from "@/components/arc/badge/badge";
import { TextMorph } from "@/components/arc/text-morph/text-morph";
import { ThinkingLoader } from "@/components/affect/thinking-loader";
import { SmartRecommendation } from "@/components/affect/smart-recommendation";
import { ensureArcTokens } from "@/components/editor-area/board/arc-tokens";
import { useTalkStore } from "@/stores/talk-store";
import { PICTURES, isBoardDiagram, isEmptyTopic, pictureOf, topicFill } from "@/lib/talk/ask";
import { TalkDiagram } from "./talk-diagram";
import { TalkBoard } from "./talk-board";
import { startsSmall } from "@/lib/talk/whisper-models";
import { PicturePreview, PicturePreviews } from "./picture-preview";
import "./talk-box.css";

// What you're saying, as you say it (SPECs/talk-notes-spec.md#while-you-talk-ask):
// the talk's topics as tabs, what the pen is doing, the New topic? card, and
// the shown topic's diagram. Loaded lazily with the first take, so a note
// never pays for Arc, motion or affectUI at startup.

export default function TalkBox() {
  const ask = useTalkStore((s) => s.ask);
  const pinned = useTalkStore((s) => s.pinned);
  const undo = useTalkStore((s) => s.undo);
  const live = useTalkStore((s) => s.live);
  const liveError = useTalkStore((s) => s.liveError);
  const model = useTalkStore((s) => s.model);
  const progress = useTalkStore((s) => s.progress);
  const notePath = useTalkStore((s) => s.notePath);
  const asked = useTalkStore((s) => s.asked);
  useEffect(() => ensureArcTokens(), []);

  const shown = pinned ?? ask.current;
  const topic = shown ? ask.topics[shown] : undefined;
  const parked = Object.entries(ask.parked).filter(([k]) => !ask.open.includes(k));
  const cardKey = ask.offer?.key ?? undo?.key ?? null;
  const cardTopic = cardKey ? ask.topics[cardKey] : undefined;
  // The picture it has, or the one you just asked for.
  const picture = asked && asked.key === topic?.key ? asked.kind : pictureOf(topic?.mermaid);
  const canDraw = live === "listening" && !!topic && !isEmptyTopic(topic);
  const current = ask.current ? ask.topics[ask.current] : undefined;
  const askedSays = asked && PICTURES.find((p) => p.kind === asked.kind)?.says;

  return (
    <div className="talk-box" role="region" aria-label="What you're saying">
      <div className="talk-box-head">
        <div className="talk-box-tabs">
          {ask.open.length > 0 && shown && (
            <div className="talk-box-topics" role="tablist" aria-label="Topics">
              {ask.open.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={k === shown}
                  className="talk-box-tab"
                  onClick={() => useTalkStore.getState().pin(k)}
                >
                  {ask.topics[k]?.short ?? k}
                  <span className="talk-box-fill">
                    <TextMorph>{ask.topics[k] ? topicFill(ask.topics[k]) : ""}</TextMorph>
                  </span>
                </button>
              ))}
            </div>
          )}
          {parked.map(([k, lines]) => (
            <Badge key={k} size="sm" tone="neutral" title="Said in passing; it waits here">
              {ask.topics[k]?.short ?? k} +{lines.length}
            </Badge>
          ))}
          {pinned && (
            <button
              type="button"
              className="talk-box-follow"
              onClick={() => useTalkStore.getState().pin(null)}
            >
              Back to what I'm saying
            </button>
          )}
        </div>
        <div className="talk-box-status">
          {live === "listening" && askedSays ? (
            <ThinkingLoader
              key="asked"
              size="sm"
              variant="plain"
              phases={[`Drawing it ${askedSays}`]}
            />
          ) : live === "listening" ? (
            <ThinkingLoader
              size="sm"
              variant="plain"
              phases={["Listening"]}
              done={Boolean(ask.cue)}
              doneLabel={ask.cue ?? ""}
            />
          ) : null}
        </div>
      </div>
      <div className="talk-box-stage">
        {cardKey && cardTopic && (
          <div className="talk-box-card">
            <SmartRecommendation
              key={cardKey}
              title="New topic?"
              options={[
                {
                  id: "start",
                  label: "New tab",
                  reason: `You said “${ask.offer?.cue ?? "next"}” and turned to ${cardTopic.title.charAt(0).toLowerCase()}${cardTopic.title.slice(1)}.`,
                  signal: 3,
                },
                {
                  id: "aside",
                  label: "Aside",
                  reason:
                    "Said in passing: it stays in the transcript and the picture doesn't move.",
                  signal: 1,
                },
              ]}
              onAccept={(o) =>
                o.id === "start"
                  ? useTalkStore.getState().accept()
                  : useTalkStore.getState().aside()
              }
              onUndo={() => useTalkStore.getState().undoAnswer()}
            />
          </div>
        )}
        {live === "needs-model" && model ? (
          <div className="talk-box-empty">
            <p>
              {startsSmall(model.id)
                ? `Topics and their diagrams show here as you talk, once Whisper is on this Mac. It starts with ${model.name} (${Math.round(model.bytes / 1e6)} MB): a smaller model, but faster. Large v3 Turbo follows in the background. Your take records either way.`
                : `Topics and their diagrams show here as you talk, once Whisper is on this Mac (${Math.round(model.bytes / 1e6)} MB, downloaded once). Your take records either way.`}
            </p>
            <button
              type="button"
              className="talk-box-button"
              onClick={() => void useTalkStore.getState().download()}
            >
              Download {model.name}
            </button>
          </div>
        ) : live === "downloading" && model ? (
          <p className="talk-box-empty">
            Downloading {model.name} ·{" "}
            <span className="talk-box-num">{Math.floor(progress * 100)}%</span>
          </p>
        ) : topic?.mermaid && notePath && isBoardDiagram(topic.mermaid) ? (
          <TalkBoard
            topicKey={topic.key}
            label={topic.title}
            notePath={notePath}
            source={topic.mermaid}
          />
        ) : topic?.mermaid ? (
          <TalkDiagram source={topic.mermaid} label={topic.title} />
        ) : (
          <p className="talk-box-empty">
            {liveError ??
              (topic
                ? "Its diagram starts with your next sentence."
                : "Talk about what's on your mind; its picture draws here as you go.")}
          </p>
        )}
      </div>
      {liveError && topic?.mermaid && <p className="talk-box-error">{liveError}</p>}
      {(live === "listening" || live === "error") && (
        <div className="talk-box-foot">
          <span className="talk-box-say" id="talk-box-say">
            Say or click
          </span>
          <div className="talk-box-pictures" role="group" aria-labelledby="talk-box-say">
            <PicturePreviews>
              {PICTURES.map((p) => (
                <PicturePreview key={p.kind} kind={p.kind} says={p.says}>
                  <button
                    type="button"
                    className="talk-box-picture"
                    aria-pressed={picture === p.kind}
                    data-pending={(asked?.kind === p.kind && asked.key === topic?.key) || undefined}
                    disabled={!canDraw}
                    onClick={() => useTalkStore.getState().redraw(p.kind)}
                  >
                    {p.says}
                  </button>
                </PicturePreview>
              ))}
            </PicturePreviews>
          </div>
          <button
            type="button"
            className="talk-box-picture talk-box-next"
            disabled={live !== "listening" || isEmptyTopic(current)}
            onClick={() => useTalkStore.getState().newTopic()}
          >
            next topic
          </button>
        </div>
      )}
    </div>
  );
}
