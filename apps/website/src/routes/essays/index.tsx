import { createFileRoute } from "@tanstack/react-router";

import { PageIndex } from "../../components/ContentPage";
import { pageHead } from "../../pages/head";
import { loadPageList } from "../../pages/load";
import { indexPath, PAGE_TYPES } from "../../pages/types";

export const Route = createFileRoute("/essays/")({
  loader: () => loadPageList("essays"),
  head: () =>
    pageHead({
      title: PAGE_TYPES["essays"].name,
      description: PAGE_TYPES["essays"].summary,
      path: indexPath("essays"),
      ogType: "website",
    }),
  component: () => <PageIndex type="essays" pages={Route.useLoaderData()} />,
});
