import { createFileRoute } from "@tanstack/react-router";

import { PageIndex } from "../../components/ContentPage";
import { pageHead } from "../../pages/head";
import { loadPageList } from "../../pages/load";
import { indexPath, PAGE_TYPES } from "../../pages/types";

export const Route = createFileRoute("/articles/")({
  loader: () => loadPageList("articles"),
  head: () =>
    pageHead({
      title: PAGE_TYPES["articles"].name,
      description: PAGE_TYPES["articles"].summary,
      path: indexPath("articles"),
      ogType: "website",
    }),
  component: () => <PageIndex type="articles" pages={Route.useLoaderData()} />,
});
