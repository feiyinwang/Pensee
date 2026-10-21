/**
 * schema.org JSON-LD for the site's pages. Each helper describes only what the
 * page shows: FAQPage from its `## Questions`, HowTo from its numbered steps.
 */
import { DOWNLOAD, REPO, VERSION } from "../content";
import { absoluteUrl, SITE_NAME } from "../site";
import type { Page } from "./parse";

export type JsonLd = Record<string, unknown>;

export function faqPage(page: Page): JsonLd | null {
  if (page.questions.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.questions.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

/** Only for a page with numbered steps; the first numbered list is the steps. */
export function howTo(page: Page): JsonLd | null {
  if (page.steps.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: page.title,
    description: page.description,
    url: absoluteUrl(page.path),
    dateModified: page.updated,
    step: page.steps.map((text, i) => ({ "@type": "HowToStep", position: i + 1, text })),
  };
}

export function softwareApplication(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "ProductivityApplication",
    operatingSystem: "macOS (Apple Silicon)",
    softwareVersion: VERSION,
    url: absoluteUrl("/"),
    downloadUrl: DOWNLOAD,
    sameAs: REPO,
    license: "https://www.gnu.org/licenses/gpl-3.0.html",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}
