import { createFileRoute } from "@tanstack/react-router";

import { PageIndex } from "../../components/ContentPage";
import { pageHead } from "../../pages/head";
import { loadPageList } from "../../pages/load";
import { indexPath, PAGE_TYPES } from "../../pages/types";

export const Route = createFileRoute("/docs/")({
  loader: () => loadPageList("docs"),
  head: () =>
    pageHead({
      title: PAGE_TYPES["docs"].name,
      description: PAGE_TYPES["docs"].summary,
      path: indexPath("docs"),
      ogType: "website",
    }),
  component: () => <PageIndex type="docs" pages={Route.useLoaderData()} />,
});
