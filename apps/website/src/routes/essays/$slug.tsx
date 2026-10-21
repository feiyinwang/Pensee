import { createFileRoute } from "@tanstack/react-router";

import { EssayPage } from "../../components/ContentPage";
import { pageHead } from "../../pages/head";
import { loadPage } from "../../pages/load";

export const Route = createFileRoute("/essays/$slug")({
  loader: ({ params }) => loadPage("essays", params.slug),
  head: ({ loaderData: page }) => (page ? pageHead(page) : {}),
  component: () => <EssayPage page={Route.useLoaderData()} />,
});
