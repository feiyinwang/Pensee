import { Link, createFileRoute } from "@tanstack/react-router";

import { PenseeMark } from "../components/Mark";

const FEATURES = [
  { label: "Private", description: "all your documents live in your computer" },
  { label: "Blazing fast", description: "cold starts takes a fraction of a second" },
  { label: "Extended markdown", description: "mermaid charts, tables and HTML" },
  { label: "Multiwindow", description: "snappy switch between multiple workspaces" },
  { label: "Frontmatter", description: "YAML metadata support built-in" },
];

const DEMOS = [
  "/demo-videos/00.mp4",
  "/demo-videos/01.mp4",
  "/demo-videos/02.mp4",
  "/demo-videos/03.mp4",
  "/demo-videos/04.mp4",
  "/demo-videos/05.mp4",
  "/demo-videos/06.mp4",
  "/demo-videos/07.mp4",
  "/demo-videos/08.mp4",
];

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="page">
      <main className="hero">
        <header className="site-header">
          <Link className="brand" to="/" aria-label="Pensée">
            <PenseeMark size={28} />
            <span className="wordmark">PENSÉE</span>
          </Link>
        </header>

        <h1 className="headline">Thinking, made by writing.</h1>

        <p className="status">For macOS. Not yet available to download.</p>

        <p className="caption">Free and open source, under the GPL.</p>

        <ul className="features">
          {FEATURES.map(({ label, description }) => (
            <li className="feature" key={label}>
              <span className="feature-label">{label}</span>
              <span className="feature-desc">{description}</span>
            </li>
          ))}
        </ul>
      </main>

      <aside className="screenshots">
        {DEMOS.map((src) => (
          <DemoVideo key={src} src={src} />
        ))}
      </aside>
    </div>
  );
}

function DemoVideo({ src }: { src: string }) {
  return (
    <div className="shot">
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label="Pensée app demo"
      />
    </div>
  );
}
