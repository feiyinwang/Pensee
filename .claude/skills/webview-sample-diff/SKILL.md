---
name: webview-sample-diff
description: Measure lag in the user's real Pensée window by sampling its WebKit page process with macOS `sample` while they repeat an action, before and after a fix, and print the cost per action side by side with idle work subtracted. Use when the user says something feels slow, laggy or stuck in their app, especially when e2e PERF journeys or JS timers say it is fast. Triggers on: slow, lag, laggy, stutter, freeze, janky, "feels slow", "still slow", instant, pinch, profile, sample, WebContent.
---

# WebView sample diff

Find what the page's main thread actually does during a slow action in the
user's own window, fix it, and prove the fix with the same recording.

## How it works (low level)

**Two processes.** A Tauri window is a `WKWebView`. The app binary
(`Pensée.app/Contents/MacOS/desktop`, Rust + AppKit) only hosts the view.
WebKit runs the page itself (HTML, CSS, every line of our JS and React) in a
separate process, `com.apple.WebKit.WebContent`, started a second after the
app. Input arrives there over IPC from the app process (`WebPage::mouseEvent`,
`wheelEvent`, `gestureEvent`). The finished frame leaves as a layer tree,
which the app and GPU processes composite. So the page's cost lives in
WebContent's main thread, and sampling the app binary shows nothing useful.

**The main thread is a run loop.** It sleeps in `mach_msg` until something
wakes it: an IPC message (an input event), a timer (a JS `setTimeout`, or
WebKit's own: the style-recalc timer, the rendering-update timer), or a
run-loop source. Each wake runs one task to completion; nothing else on that
thread runs until it returns. Time spent asleep (`__CFRunLoopServiceMachPort`)
is idle. Everything else is busy.

**One rendering update per frame.** `Page::updateRendering` is the browser's
frame pipeline: `requestAnimationFrame` callbacks, ResizeObserver and
IntersectionObserver, style recalc (`Document::resolveStyle`: matching CSS
rules and inheriting custom properties to every changed element), layout
(`LocalFrameViewLayoutContext::layout`, the `RenderBlock`/`RenderFlexibleBox`
/`RenderGrid` frames), CSS Custom Highlight positions
(`Document::updateHighlightPositions`), compositing layers
(`RenderLayerCompositor`), then the layer-tree transaction to the app
process. If any step takes 480ms, that frame shows 480ms late, and the user
feels it as lag.

**Why JS timers miss it.** `performance.now()` around a handler measures one
JS task. Reading `offsetHeight` forces style and layout, but not the rest of
the rendering update (highlights, compositing). The e2e window is hidden, so
WebKit barely schedules rendering updates there at all. A cost that lives in
the rendering update is invisible to every in-page probe and to PERF, and only
an outside view of the process sees it.

**What `sample` does.** It is a statistical profiler. Every 1ms it suspends
the target's threads through the Mach task port, reads each thread's
registers, walks its stack through the frame pointers, maps each return
address to a symbol in the loaded images (WebCore, WebKit and JavaScriptCore
ship symbols; JIT-compiled JS shows as `???`), and resumes the process. It
merges identical stacks into a call tree. A line's count is the number of
samples in which that frame was on the stack, so at a 1ms interval a count
is roughly milliseconds, and it is inclusive of everything the frame called.
`sample` loses some ticks to its own overhead (46,435 samples in 60s), so the
scripts scale counts to the real length. The tree is a sum over the whole
recording with no timeline. That is why the user repeats the action a known
number of times, and why an idle recording is subtracted: per action = (busy
during the action − idle rate × duration) ÷ count.

## Procedure

Scripts are in this skill's `scripts/` folder. Run Python with `-I`.
Recordings go in the session's scratchpad.

```
1. Is Pensée running with the user's own workspace?
   ├── No  → ask them to open it as they use it (same tabs, same book)
   └── Yes ↓
2. find-page.sh → pid (re-run after every relaunch: the pid changes)
3. record.sh <dir> idle 15        (user hands off the trackpad)
4. record.sh <dir> before 60 &    then AskUserQuestion: "repeat <action>
   exactly 10 times, then pick Done"
5. analyze.py top <dir>/before.main.txt --actions 10
6. Is one frame family over 30% of busy?
   ├── Yes → analyze.py callers on it, map it with the table below, fix it
   └── No  → style + layout dominate: find what invalidates the whole tree
            (an attribute on a high ancestor, an inherited custom property,
            :has(), every keep-alive tab reflowing)
7. Ship (scripts/ship-local.sh), relaunch, back to step 2 for the pid,
   record `after` with the same 10 repetitions and the same tabs open
8. analyze.py diff before.main.txt after.main.txt --idle idle.main.txt --actions 10
```

Rules, each with its reason:

- **Always record idle first.** The agent panel, timers and players run in
  the background, and without the baseline their cost is charged to the
  action. 15s is enough, since idle in Pensée is near 0.
- **Always ask for an exact count.** "About 10" turns per-action numbers into
  a guess. Ten in, ten out of a toggle is 20 actions: pass `--actions 20`.
- **Same workload before and after.** The cost often scales with open tabs (30
  keep-alive tabs all restyle on a layout switch), so a recording with fewer
  tabs open proves nothing.
- **Never sample the app binary.** It holds only AppKit and Rust. The page is
  the WebContent pid from `find-page.sh`.
- **Report the diff table**, BUSY row first, per action, and say which frame
  family the fix removed.
- **Budgets are per action**, from `docs/qa/performance.md`: `show` 50ms,
  `go` 100ms. A per-action BUSY over budget is not done.

## Reading the frames

| Frame family                                                                           | What the page did                                                  | Usual cause in Pensée                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `Document::updateHighlightPositions` → `VisibleSelection` → `canonicalPosition`        | Re-validated every CSS Custom Highlight range                      | Highlight ranges registered in a hidden tab (`visibility: hidden` text), book reader |
| `PositionIterator::increment`, `RenderText::nextOffset` (outside highlights)            | Walked text a character at a time for a caret position             | Look Up / caret blink over a hidden tab's large text                                  |
| `Document::resolveStyle`, `Style::TreeResolver` (under `timerFired`)                   | Style recalc from the style timer                                  | An attribute or custom property changed high in the tree                             |
| `LocalFrameViewLayoutContext::layout`, `RenderGrid`/`RenderFlexibleBox` `layoutBlock`  | Layout                                                             | Width change reflowing every mounted tab                                             |
| `jsElement_offsetTop`, `getComputedStyle` (`CSSComputedStyleDeclaration`), `scrollHeight` | JS forcing style or layout mid-task                               | Measurement in a loop or in many components                                         |
| `JSC::` frames and `???`                                                                | Our JavaScript (`???` is JIT code)                                 | React renders, store subscribers                                                     |
| `RenderLayerCompositor::updateCompositingLayers`                                        | Rebuilding composited layers                                       | Many `will-change`/transformed layers changing                                       |
| `EventHandler::handleGestureEvent`, `performImmediateActionHitTestAtLocation`           | Trackpad gesture or force-click hit testing                        | Hit tests over large hidden content                                                  |

Related: memory `profile-webview-with-sample`, `docs/qa/performance.md`.
