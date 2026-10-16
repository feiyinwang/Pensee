import { useEffect, useState, type AnimationEvent } from "react";

/** Past this the entrance is finished outright, wherever it got to. The window
 *  mounts hidden and is shown once startup resolves, and WebKit holds a hidden
 *  window's animation clock at the first frame: a window that stays hidden
 *  would otherwise keep the splash over the app. The entrance itself takes
 *  1.28s (`--enter-reveal-at` + `--motion-enter-reveal` in App.css). */
const ENTRANCE_GUARD_MS = 3000;
/** The reveal: the splash fading and the shell settling, paired. */
const REVEAL_ANIMATIONS = new Set(["app-splash-out", "app-enter"]);
const ENTRANCE_ANIMATIONS = new Set(["app-splash-pop", "app-splash-write", ...REVEAL_ANIMATIONS]);

function entranceAnimations(): CSSAnimation[] {
  return document
    .getAnimations()
    .filter(
      (animation): animation is CSSAnimation =>
        animation instanceof CSSAnimation && ENTRANCE_ANIMATIONS.has(animation.animationName),
    );
}

/** A click or a key during the splash asks for the app: the writing and the
 *  hold are skipped and the reveal starts now. The reveal itself still plays,
 *  so the app doesn't cut in. */
function skipToReveal() {
  for (const animation of entranceAnimations()) {
    if (!REVEAL_ANIMATIONS.has(animation.animationName)) {
      animation.finish();
      continue;
    }
    const delay = animation.effect?.getComputedTiming().delay;
    const now = animation.currentTime;
    if (typeof delay === "number" && typeof now === "number" && now < delay) {
      animation.currentTime = delay;
    }
  }
}

/** The launch splash (SPECs/app-entrance-spec.md): the app icon settles in,
 *  its ¶ is written, `PENSÉE` is written under it, then the splash dissolves
 *  into the app. Decoration only: it ignores the pointer, is hidden from
 *  assistive tech, and unmounts once it has faded. */
export function AppSplash() {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const animation of entranceAnimations()) animation.finish();
      // A hidden window sends no animationend either, so unmount here too.
      setDone(true);
    }, ENTRANCE_GUARD_MS);
    // Capture, so the click or key still reaches the app as usual.
    window.addEventListener("pointerdown", skipToReveal, true);
    window.addEventListener("keydown", skipToReveal, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", skipToReveal, true);
      window.removeEventListener("keydown", skipToReveal, true);
    };
  }, []);

  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.animationName === "app-splash-out") {
      setDone(true);
    }
  };

  if (done) return null;

  return (
    <div className="app-splash" aria-hidden="true" onAnimationEnd={handleAnimationEnd}>
      <div className="app-splash-lockup">
        <div className="app-splash-icon">
          <div className="app-splash-tile" />
          {/* The ¶, small cut, as on the app icon: `assets/brand/pensee-mark-small.svg`. */}
          <svg className="app-splash-mark" viewBox="-30 10 87 80" fill="currentColor">
            <path d="M-28 12H35V68A20 20 0 0 0 55 88H29V17H21V88H0V40A28 28 0 0 0 -28 12Z" />
          </svg>
        </div>
        <div className="app-splash-wordmark">PENSÉE</div>
      </div>
    </div>
  );
}
