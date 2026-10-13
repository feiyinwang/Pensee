/// <reference types="vite/client" />

declare const __WRITER_VERSION__: string;
declare const __WRITER_DMG_URL__: string;
declare const __WRITER_RELEASES_URL__: string;
declare const __WRITER_REPO_URL__: string;

declare module "*.css";
declare module "*.css?url" {
  const href: string;
  export default href;
}
