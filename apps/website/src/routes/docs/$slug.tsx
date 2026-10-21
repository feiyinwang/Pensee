import { createFileRoute } from "@tanstack/react-router";

import { DocPage } from "../../components/ContentPage";
import { pageHead } from "../../pages/head";
import { faqPage } from "../../pages/jsonld";
import { loadPage } from "../../pages/load";

export const Route = createFileRoute("/docs/$slug")({
  loader: ({ params }) => loadPage("docs", params.slug),
  head: ({ loaderData: page }) => (page ? pageHead({ ...page, jsonLd: [faqPage(page)] }) : {}),
  component: () => <DocPage page={Route.useLoaderData()} />,
});
