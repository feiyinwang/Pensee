// Ten public-domain paintings of reading, writing and thinking rooms, one per
// update (SPECs/whats-new-card-spec.md lists their sources).
import antonello from "./paintings/antonello-saint-jerome.jpg";
import carpaccio from "./paintings/carpaccio-saint-augustine.jpg";
import chardin from "./paintings/chardin-philosopher-reading.jpg";
import durer from "./paintings/durer-saint-jerome.jpg";
import hammershoiDust from "./paintings/hammershoi-dust-motes.jpg";
import hammershoiInterior from "./paintings/hammershoi-interior.jpg";
import rembrandt from "./paintings/rembrandt-philosopher.jpg";
import terBorch from "./paintings/ter-borch-woman-writing.jpg";
import vermeerBlue from "./paintings/vermeer-woman-in-blue.jpg";
import vermeerGeographer from "./paintings/vermeer-geographer.jpg";

export interface Painting {
  src: string;
  artist: string;
  title: string;
  year: string;
  /** `object-position` that keeps the subject in the card's wide crop. */
  focus: string;
}

export const PAINTINGS: Painting[] = [
  {
    src: durer,
    artist: "Albrecht Dürer",
    title: "Saint Jerome in His Study",
    year: "1514",
    focus: "62% 58%",
  },
  {
    src: rembrandt,
    artist: "Rembrandt",
    title: "Philosopher in Meditation",
    year: "1632",
    focus: "40% 62%",
  },
  {
    src: hammershoiInterior,
    artist: "Vilhelm Hammershøi",
    title: "Interior with a Woman Seen from the Back",
    year: "1903–04",
    focus: "50% 42%",
  },
  {
    src: terBorch,
    artist: "Gerard ter Borch",
    title: "Woman Writing a Letter",
    year: "c. 1655",
    focus: "50% 46%",
  },
  {
    src: vermeerBlue,
    artist: "Johannes Vermeer",
    title: "Woman in Blue Reading a Letter",
    year: "c. 1663",
    focus: "50% 33%",
  },
  {
    src: vermeerGeographer,
    artist: "Johannes Vermeer",
    title: "The Geographer",
    year: "1669",
    focus: "50% 50%",
  },
  {
    src: hammershoiDust,
    artist: "Vilhelm Hammershøi",
    title: "Dust Motes Dancing in the Sunbeams",
    year: "1900",
    focus: "50% 45%",
  },
  {
    src: antonello,
    artist: "Antonello da Messina",
    title: "Saint Jerome in His Study",
    year: "c. 1475",
    focus: "50% 62%",
  },
  {
    src: chardin,
    artist: "Jean-Baptiste Siméon Chardin",
    title: "The Philosopher Reading",
    year: "1734",
    focus: "50% 52%",
  },
  {
    src: carpaccio,
    artist: "Vittore Carpaccio",
    title: "The Vision of Saint Augustine",
    year: "1502",
    focus: "50% 45%",
  },
];
