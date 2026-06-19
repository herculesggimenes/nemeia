import {
  Camera,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Layers3,
  Plus,
  Search,
  SlidersHorizontal,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { Artifact } from "../../lib/types";
import { cn } from "../../lib/utils";

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

export function ExtendArtifactWorkspace({
  artifacts,
  activeArtifactId,
  openArtifactIds,
  onOpenArtifact,
  onCloseArtifact,
  children
}: Props) {
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const active = artifacts.find((artifact) => artifact.id === activeArtifactId) ?? null;
  const openArtifacts = openArtifactIds
    .map((id) => artifacts.find((artifact) => artifact.id === id))
    .filter((artifact): artifact is Artifact => Boolean(artifact));
  const folders = Array.from(new Set(artifacts.map(folderForArtifact)));

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
                <div
                  className={cn(
                    "inline-flex min-h-7 max-w-[190px] shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs text-muted",
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
                  <button
                    className="inline-flex min-w-0 items-center gap-1.5 text-inherit"
                    type="button"
                    onClick={() => {
                      setFileTreeOpen(false);
                      onOpenArtifact(artifact.id);
                    }}
                  >
                    <Icon size={14} />
                    <span className="truncate whitespace-nowrap">{artifact.title}</span>
                  </button>
                  <button
                    className="grid size-[18px] place-items-center rounded text-muted hover:bg-surface-3 hover:text-foreground"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseArtifact(artifact.id);
                    }}
                    aria-label={`Close ${artifact.title}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
            <button
              className={cn(
                "inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs text-muted hover:bg-surface-3 hover:text-foreground",
                fileTreeOpen ? "bg-surface-3 text-foreground" : null
              )}
              onClick={() => setFileTreeOpen(true)}
              aria-label="Open file"
              type="button"
            >
              <Plus size={14} />
              <span>Open file</span>
            </button>
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
        <div className="flex h-[30px] items-center gap-2 rounded-lg border border-surface-3 bg-surface-2 px-2 text-xs text-muted">
          <Search size={14} />
          <span>Filter files...</span>
        </div>

        {folders.map((folder) => (
          <div className="mt-2" key={folder}>
            <div className="flex h-[25px] items-center gap-1.5 text-xs text-foreground">
              <ChevronDown size={14} />
              <span>{folder}</span>
            </div>
            {artifacts
              .filter((artifact) => folderForArtifact(artifact) === folder)
              .map((artifact) => {
                const Icon = artifactIcons[artifact.type];
                return (
                  <button
                    className={cn(
                      "grid min-h-[29px] w-full grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-md border border-transparent px-2 pl-[22px] text-left text-xs text-foreground hover:bg-surface-3",
                      artifact.id === activeArtifactId ? "bg-surface-3" : null
                    )}
                    key={artifact.id}
                    onClick={() => {
                      onOpenArtifact(artifact.id);
                      setFileTreeOpen(false);
                    }}
                  >
                    <Icon size={14} />
                    <span className="truncate whitespace-nowrap">{artifact.path.split("/").slice(1).join("/") || artifact.title}</span>
                  </button>
                );
              })}
          </div>
        ))}

        <div className="mt-2">
          <div className="flex h-[25px] items-center gap-1.5 text-xs text-foreground">
            <ChevronRight size={14} />
            <span>generated</span>
          </div>
        </div>
      </aside>
      ) : null}
    </div>
  );
}
