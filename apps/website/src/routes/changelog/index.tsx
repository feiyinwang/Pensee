import { createFileRoute } from "@tanstack/react-router";

import { ChangelogPage, DESCRIPTION, TITLE } from "../../components/ChangelogPage";
import { pageHead } from "../../pages/head";
import { loadChangelog } from "../../pages/load";

export const Route = createFileRoute("/changelog/")({
  loader: () => loadChangelog(),
  head: () =>
    pageHead({ title: TITLE, description: DESCRIPTION, path: "/changelog/", ogType: "website" }),
  component: () => <ChangelogPage days={Route.useLoaderData()} />,
});
