import { createFileRoute } from "@tanstack/react-router";

import { PageIndex } from "../../components/ContentPage";
import { pageHead } from "../../pages/head";
import { loadPageList } from "../../pages/load";
import { indexPath, PAGE_TYPES } from "../../pages/types";

export const Route = createFileRoute("/guides/")({
  loader: () => loadPageList("guides"),
  head: () =>
    pageHead({
      title: PAGE_TYPES["guides"].name,
      description: PAGE_TYPES["guides"].summary,
      path: indexPath("guides"),
      ogType: "website",
    }),
  component: () => <PageIndex type="guides" pages={Route.useLoaderData()} />,
});
