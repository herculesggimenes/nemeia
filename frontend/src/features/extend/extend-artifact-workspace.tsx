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
    <div className={`extendWorkspace ${fileTreeOpen ? "fileTreeOpen" : "fileTreeClosed"}`}>
      <section className="extendEditor">
        <header className="extendTabBar">
          <div className="extendTabs">
            {openArtifacts.map((artifact) => {
              const Icon = artifactIcons[artifact.type];
              return (
                <div
                  className={`extendTab ${artifact.id === activeArtifactId ? "active" : ""}`}
                  key={artifact.id}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      onCloseArtifact(artifact.id);
                    }
                  }}
                >
                  <button
                    className="extendTabMain"
                    type="button"
                    onClick={() => {
                      setFileTreeOpen(false);
                      onOpenArtifact(artifact.id);
                    }}
                  >
                    <Icon size={14} />
                    <span>{artifact.title}</span>
                  </button>
                  <button
                    className="extendTabClose"
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
              className={`extendOpenFile ${fileTreeOpen ? "active" : ""}`}
              onClick={() => setFileTreeOpen(true)}
              aria-label="Open file"
            >
              <Plus size={14} />
              <span>Open file</span>
            </button>
          </div>
        </header>

        <section className="extendPreview">
          {active ? (
            <>
              <div className="extendPreviewPath">
                <span>{active.path}</span>
                <em>{active.contentType}</em>
              </div>
              {children}
            </>
          ) : (
            <div className="extendEmptyPreview">
              <Folder size={28} />
              <strong>Open an artifact</strong>
              <span>Select a file from the artifact tree.</span>
            </div>
          )}
        </section>
      </section>

      {fileTreeOpen ? (
      <aside className="extendFileTree" aria-label="Artifact file tree">
        <div className="extendTreeSearch">
          <Search size={14} />
          <span>Filter files...</span>
        </div>

        {folders.map((folder) => (
          <div className="extendTreeFolder" key={folder}>
            <div className="extendFolderRow">
              <ChevronDown size={14} />
              <span>{folder}</span>
            </div>
            {artifacts
              .filter((artifact) => folderForArtifact(artifact) === folder)
              .map((artifact) => {
                const Icon = artifactIcons[artifact.type];
                return (
                  <button
                    className={`extendTreeFile ${artifact.id === activeArtifactId ? "active" : ""}`}
                    key={artifact.id}
                    onClick={() => {
                      onOpenArtifact(artifact.id);
                      setFileTreeOpen(false);
                    }}
                  >
                    <Icon size={14} />
                    <span>{artifact.path.split("/").slice(1).join("/") || artifact.title}</span>
                  </button>
                );
              })}
          </div>
        ))}

        <div className="extendTreeFolder collapsed">
          <div className="extendFolderRow">
            <ChevronRight size={14} />
            <span>generated</span>
          </div>
        </div>
      </aside>
      ) : null}
    </div>
  );
}
