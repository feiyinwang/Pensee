import { createFileRoute } from "@tanstack/react-router";

import { DownloadButton, FinePrint, Requirements } from "../components/DownloadButton";
import { FeatureCard } from "../components/FeatureCard";
import { InstallLine } from "../components/InstallLine";
import { Credit, Painting } from "../components/Painting";
import { SiteBar } from "../components/SiteBar";
import { SiteFooter } from "../components/SiteFooter";
import { TalkDemo } from "../components/TalkDemo";
import { useScrolledPast } from "../components/useScrolledPast";
import { HEADLINE, INTRO, PAINTINGS, ROOMS, VERSION } from "../content";
import { jsonLdScript } from "../pages/head";
import { softwareApplication } from "../pages/jsonld";
import { absoluteUrl } from "../site";

export const Route = createFileRoute("/")({
  // The root's title and description are the homepage's; it adds what's only its own.
  head: () => ({
    links: [
      { rel: "canonical", href: absoluteUrl("/") },
      // The hero painting is the first thing on screen: fetch it with the page.
      { rel: "preload", as: "image", href: PAINTINGS.rembrandt.src, fetchPriority: "high" },
    ],
    meta: [{ property: "og:url", content: absoluteUrl("/") }],
    scripts: [jsonLdScript(softwareApplication())],
  }),
  component: HomePage,
});

const ROMAN = ["I", "II", "III", "IV"];

/** One page, one action: Download, for the visitor's Mac or Windows PC (SPECs/website-homepage-spec.md). */
function HomePage() {
  const [heroEnd, pastHero] = useScrolledPast<HTMLDivElement>();
  return (
    <div className="page">
      <SiteBar onHome downloadShown={pastHero} dark={!pastHero} />

      <main id="top">
        {/* The philosopher sits left of centre, so the words take the dark stair on the right. */}
        <section className="full hero">
          <Painting painting={PAINTINGS.rembrandt} eager />
          <div className="scrim" aria-hidden="true" />
          <div className="over">
            <div className="eyebrow">Pensée for Mac and Windows · version {VERSION}</div>
            <h1>{HEADLINE}</h1>
            <p className="stand">{INTRO}</p>
            <div className="acts">
              <DownloadButton size="lg" tone="light" beta />
              <a className="tlink" href="#talk">
                See what it does
              </a>
            </div>
            <div className="meta">
              <Requirements />
            </div>
          </div>
          <p className="credit">
            <Credit painting={PAINTINGS.rembrandt} /> · {PAINTINGS.rembrandt.at}
          </p>
        </section>
        {/* The hero's bottom edge: the bar stays dark, without its Download,
            until it scrolls under it. */}
        <div ref={heroEnd} aria-hidden="true" />

        {/* The newest feature is the first thing under the hero. */}
        <TalkDemo />

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
            <div className="meta">
              <Requirements />
            </div>
            <InstallLine />
            <FinePrint />
          </div>
          <p className="credit">
            <Credit painting={PAINTINGS.hammershoi} /> · {PAINTINGS.hammershoi.at}
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
