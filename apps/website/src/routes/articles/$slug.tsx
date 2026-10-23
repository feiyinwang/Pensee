import { createFileRoute } from "@tanstack/react-router";

import { ArticlePage } from "../../components/ContentPage";
import { pageHead } from "../../pages/head";
import { faqPage, howTo, softwareApplication } from "../../pages/jsonld";
import { loadPage } from "../../pages/load";

export const Route = createFileRoute("/articles/$slug")({
  loader: ({ params }) => loadPage("articles", params.slug),
  head: ({ loaderData: page }) =>
    page ? pageHead({ ...page, jsonLd: [softwareApplication(), howTo(page), faqPage(page)] }) : {},
  component: () => <ArticlePage page={Route.useLoaderData()} />,
});
