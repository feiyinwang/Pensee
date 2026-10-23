import { useLoaderData } from "@tanstack/react-router";

import { indexPath, PAGE_TYPES } from "../pages/types";

/**
 * A link to the index of each type that has a page (the root loader says
 * which), in the header and the footer. With no pages it renders nothing, so
 * the site never shows an empty section.
 */
export function SectionLinks({ className }: { className?: string }) {
  const sections = useLoaderData({ from: "__root__" });
  if (sections.length === 0) return null;
  return (
    <nav aria-label="Pages" className={className}>
      {sections.map((type) => (
        <a href={indexPath(type)} key={type}>
          {PAGE_TYPES[type].name}
        </a>
      ))}
    </nav>
  );
}
