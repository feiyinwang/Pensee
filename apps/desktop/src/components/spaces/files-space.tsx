import { FileTree } from "@/components/sidebar/file-tree";
import { navigateToFile } from "@/hooks/editor-api";
import { useWorkspaceFileCount } from "@/hooks/use-file-tree";
import { useFileTreeRenaming } from "@/hooks/use-spaces";
import { useWorkspaceRoot } from "@/hooks/use-workspace";
import styles from "./spaces.module.css";

/** The Files space: the folder tree that used to fill the sidebar
 *  (SPECs/spaces-spec.md). A file opens in this tab, like a note from any
 *  other space; Back returns here. */
export function FilesSpace({ name }: { name: string }) {
  const root = useWorkspaceRoot();
  const fileCount = useWorkspaceFileCount();
  const [renamingPath, setRenamingPath] = useFileTreeRenaming();
  if (!root) return null;

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>{name}</h1>
        {fileCount > 0 && <span className={styles.count}>{fileCount.toLocaleString()}</span>}
      </header>
      <div data-files-space className="max-w-2xl">
        <FileTree
          rootPath={root}
          openFile={navigateToFile}
          renamingPath={renamingPath}
          onRenamingPathChange={setRenamingPath}
        />
      </div>
    </>
  );
}
