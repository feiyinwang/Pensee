import { useEffect, useState, type AnimationEvent } from "react";

/** Past this the entrance is finished outright, wherever it got to. The window
 *  mounts hidden and is shown once startup resolves, and WebKit holds a hidden
 *  window's animation clock at the first frame: a window that stays hidden
 *  would otherwise keep the splash over the app. The entrance itself takes
 *  about 1.5s (`--enter-reveal-at` + `--motion-enter-reveal` in App.css). */
const ENTRANCE_GUARD_MS = 3000;
const ENTRANCE_ANIMATIONS = new Set(["app-splash-write", "app-splash-out", "app-enter"]);

/** The launch splash (SPECs/app-entrance-spec.md): the brand ¶ written left
 *  to right with `PENSÉE` under it, then dissolving into the app. Decoration
 *  only: it ignores the pointer, is hidden from assistive tech, and unmounts
 *  once it has faded. */
export function AppSplash() {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const animation of document.getAnimations()) {
        if (animation instanceof CSSAnimation && ENTRANCE_ANIMATIONS.has(animation.animationName)) {
          animation.finish();
        }
      }
      // A hidden window sends no animationend either, so unmount here too.
      setDone(true);
    }, ENTRANCE_GUARD_MS);
    return () => window.clearTimeout(timer);
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
        {/* The ¶, display cut: `assets/brand/pensee-mark.svg`. */}
        <svg className="app-splash-mark" viewBox="-32 10 88 80" fill="currentColor">
          <path d="M-30 12H32V66A22 22 0 0 0 54 88H29V15H21V88H0V42A30 30 0 0 0 -30 12Z" />
        </svg>
        <div className="app-splash-wordmark">PENSÉE</div>
      </div>
    </div>
  );
}
