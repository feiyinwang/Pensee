import { createFileRoute } from "@tanstack/react-router";

import { GuidePage } from "../../components/ContentPage";
import { pageHead } from "../../pages/head";
import { faqPage, howTo, softwareApplication } from "../../pages/jsonld";
import { loadPage } from "../../pages/load";

export const Route = createFileRoute("/guides/$slug")({
  loader: ({ params }) => loadPage("guides", params.slug),
  head: ({ loaderData: page }) =>
    page ? pageHead({ ...page, jsonLd: [softwareApplication(), howTo(page), faqPage(page)] }) : {},
  component: () => <GuidePage page={Route.useLoaderData()} />,
});
