import {
  Camera,
  FileText,
  Folder,
  Layers3,
  Plus,
  Search,
  SlidersHorizontal,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { Artifact } from "../../types/nemeia";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { FileTree, type FileTreeNode } from "../navigation/file-tree";

type Props = {
  artifacts: Artifact[];
  activeArtifactId: Artifact["id"] | null;
  openArtifactIds: Artifact["id"][];
  onOpenArtifact: (id: Artifact["id"]) => void;
  onCloseArtifact: (id: Artifact["id"]) => void;
  children: ReactNode;
};

const artifactIcons: Record<Artifact["type"], typeof Camera> = {
  camera: Camera,
  point_cloud: Layers3,
  control: SlidersHorizontal,
  artifact: FileText
};

function folderForArtifact(artifact: Artifact) {
  const [root] = artifact.path.split("/");
  return root || "artifacts";
}

export function ArtifactWorkspace({
  artifacts,
  activeArtifactId,
  openArtifactIds,
  onOpenArtifact,
  onCloseArtifact,
  children
}: Props) {
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const active = artifacts.find((artifact) => artifact.id === activeArtifactId) ?? null;
  const openArtifacts = useMemo(
    () =>
      openArtifactIds
        .map((id) => artifacts.find((artifact) => artifact.id === id))
        .filter((artifact): artifact is Artifact => Boolean(artifact)),
    [artifacts, openArtifactIds]
  );
  const fileTreeNodes: FileTreeNode[] = useMemo(
    () =>
      Array.from(new Set(artifacts.map(folderForArtifact))).map((folder) => ({
        id: `artifact-folder-${folder}`,
        label: folder,
        icon: Folder,
        children: artifacts
          .filter((artifact) => folderForArtifact(artifact) === folder)
          .map((artifact) => ({
            id: artifact.id,
            label: artifact.path.split("/").slice(1).join("/") || artifact.title,
            detail: artifact.contentType,
            icon: artifactIcons[artifact.type]
          }))
      })),
    [artifacts]
  );

  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-rows-[minmax(0,1fr)]",
        fileTreeOpen ? "grid-cols-[minmax(0,1fr)_minmax(210px,260px)]" : "grid-cols-[minmax(0,1fr)]"
      )}
      data-testid="artifact-workspace"
      data-file-tree-open={fileTreeOpen}
    >
      <section className={cn("grid min-h-0 min-w-0 grid-rows-[38px_minmax(0,1fr)]", fileTreeOpen ? "border-r border-surface-3" : null)}>
        <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-surface-3 bg-surface-1">
          <div className="thin-scrollbar-x flex min-w-0 items-center gap-0.5 overflow-x-auto px-2 py-1.5" data-testid="artifact-tabs">
            {openArtifacts.map((artifact) => {
              const Icon = artifactIcons[artifact.type];
              return (
                <Card
                  className={cn(
                    "inline-flex min-h-7 max-w-[190px] shrink-0 items-center gap-1.5 border-transparent bg-transparent px-2 text-xs text-muted shadow-none",
                    artifact.id === activeArtifactId ? "border-surface-3 bg-surface-3 text-foreground" : null
                  )}
                  key={artifact.id}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      onCloseArtifact(artifact.id);
                    }
                  }}
                >
                  <Button
                    className="inline-flex min-w-0 items-center gap-1.5 text-inherit"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFileTreeOpen(false);
                      onOpenArtifact(artifact.id);
                    }}
                  >
                    <Icon size={14} />
                    <span className="truncate whitespace-nowrap">{artifact.title}</span>
                  </Button>
                  <Button
                    className="size-[18px]"
                    variant="icon"
                    size="iconSm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseArtifact(artifact.id);
                    }}
                    aria-label={`Close ${artifact.title}`}
                  >
                    <X size={12} />
                  </Button>
                </Card>
              );
            })}
            <Button
              className={cn(
                "inline-flex min-h-7 shrink-0 gap-1.5 border-transparent px-2 text-xs",
                fileTreeOpen ? "bg-surface-3 text-foreground" : null
              )}
              onClick={() => setFileTreeOpen(true)}
              aria-label="Open file"
              variant="tab"
              size="sm"
            >
              <Plus size={14} />
              <span>Open file</span>
            </Button>
          </div>
        </header>

        <section className={cn("grid min-h-0 min-w-0", fileTreeOpen ? "grid-rows-[minmax(0,1fr)]" : "grid-rows-[28px_minmax(0,1fr)]")}>
          {active ? (
            <>
              <div
                className={cn(
                  "grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,max-content)] items-center gap-3 border-b border-surface-3 px-2.5 text-[11px] text-muted",
                  fileTreeOpen ? "hidden" : null
                )}
                data-testid="artifact-preview-path"
              >
                <span className="min-w-0 truncate whitespace-nowrap">{active.path}</span>
                <em className="max-w-[44%] truncate whitespace-nowrap not-italic">{active.contentType}</em>
              </div>
              {children}
            </>
          ) : (
            <div className="grid place-items-center content-center gap-2 text-muted">
              <Folder size={28} />
              <strong className="text-foreground">Open an artifact</strong>
              <span>Select a file from the artifact tree.</span>
            </div>
          )}
        </section>
      </section>

      {fileTreeOpen ? (
      <aside className="min-h-0 min-w-0 overflow-auto bg-surface-1 p-2" aria-label="Artifact file tree">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 text-muted" size={14} />
          <Input
            aria-label="Filter files"
            className="h-[30px] pl-8 text-xs"
            placeholder="Filter files..."
            readOnly
            value=""
          />
        </div>

        <FileTree
          activeId={activeArtifactId}
          ariaLabel="Artifact file tree"
          className="mt-2"
          nodes={fileTreeNodes}
          testId="artifact-file-tree"
          onSelect={(id) => {
            onOpenArtifact(id);
            setFileTreeOpen(false);
          }}
        />
      </aside>
      ) : null}
    </div>
  );
}
