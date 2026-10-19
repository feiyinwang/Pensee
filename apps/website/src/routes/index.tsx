import { createFileRoute } from "@tanstack/react-router";

import { Cloth } from "../components/Cloth";
import { DownloadButton } from "../components/DownloadButton";
import { FeatureCard } from "../components/FeatureCard";
import { InstallLine } from "../components/InstallLine";
import { PenseeMark } from "../components/Mark";
import { Credit, Painting } from "../components/Painting";
import {
  FINE_PRINT,
  HEADLINE,
  INTRO,
  PAINTINGS,
  REPO,
  REQUIREMENTS,
  ROOMS,
  VERSION,
} from "../content";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const ROMAN = ["I", "II", "III", "IV"];

/** One page, one action: Download for Mac (SPECs/website-homepage-spec.md). */
function HomePage() {
  return (
    <div className="page">
      <header className="bar">
        <a className="lockup" href="#top" aria-label="Pensée, back to top">
          <PenseeMark size={18} />
          <span className="wordmark">PENSÉE</span>
        </a>
        <DownloadButton />
      </header>

      <main id="top">
        {/* The philosopher sits left of centre, so the words take the dark stair on the right. */}
        <section className="full hero">
          <Painting painting={PAINTINGS.rembrandt} eager>
            <Cloth />
          </Painting>
          <div className="scrim" aria-hidden="true" />
          <div className="over">
            <div className="eyebrow">Pensée for Mac · version {VERSION}</div>
            <h1>{HEADLINE}</h1>
            <p className="stand">{INTRO}</p>
            <div className="acts">
              <DownloadButton size="lg" tone="light" beta />
              <a className="tlink" href="#room-think">
                See what it does
              </a>
            </div>
            <div className="meta">{REQUIREMENTS}</div>
          </div>
          <p className="credit">
            <Credit painting={PAINTINGS.rembrandt} /> · {PAINTINGS.rembrandt.at}
          </p>
        </section>

        {ROOMS.map((room, i) => (
          <section className="room" id={`room-${room.id}`} key={room.id}>
            <Painting painting={room.painting}>
              <figcaption>
                <Credit painting={room.painting} />
                <small>{room.painting.at}</small>
              </figcaption>
            </Painting>
            <div className="room-head">
              <div>
                <div className="eyebrow">
                  Room {ROMAN[i]} · {room.features.length} features
                </div>
                <h2>{room.name}</h2>
              </div>
              <p>{room.intro}</p>
            </div>
            <div className="cards">
              {room.features.map((feature) => (
                <FeatureCard feature={feature} room={room.name} key={feature.id} />
              ))}
            </div>
          </section>
        ))}

        <section className="full closing">
          <Painting painting={PAINTINGS.hammershoi} />
          <div className="scrim" aria-hidden="true" />
          <div className="over">
            <div className="eyebrow">Ready when you are</div>
            <h2>Start writing what you think.</h2>
            <div className="acts">
              <DownloadButton size="lg" tone="light" />
            </div>
            <div className="meta">{REQUIREMENTS}</div>
            <InstallLine />
            <p className="fine">{FINE_PRINT}</p>
          </div>
          <p className="credit">
            <Credit painting={PAINTINGS.hammershoi} /> · {PAINTINGS.hammershoi.at}
          </p>
        </section>
      </main>

      <footer className="foot">
        <span>Pensée is GPL v3. Neither the app nor this site collects usage data.</span>
        <nav aria-label="Project">
          <a href={REPO}>GitHub</a>
          <a href={`${REPO}/releases`}>Releases</a>
          <a href={`${REPO}/blob/master/LICENSE`}>License</a>
        </nav>
      </footer>
    </div>
  );
}
