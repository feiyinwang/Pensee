import type { Key } from "../content";

const label = (k: Key) => (typeof k === "string" ? k : k.say);

/** A shortcut as light keycaps; a gesture with no key is written as words. */
export function Keycaps({ keys }: { keys: Key[] }) {
  if (keys.length === 0) return null;
  return (
    <span className="keys" aria-label={`Shortcut: ${keys.map(label).join(" ")}`}>
      {keys.map((k, i) =>
        typeof k === "string" ? (
          <kbd key={i}>{k}</kbd>
        ) : (
          <span className="say" key={i}>
            {k.say}
          </span>
        ),
      )}
    </span>
  );
}
