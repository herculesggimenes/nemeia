"use client";

import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export type FileTreeNode = {
  id: string;
  label: string;
  ariaLabel?: string;
  detail?: string;
  statusLabel?: string;
  statusTone?: string;
  icon?: ComponentType<{ className?: string; size?: number }>;
  children?: FileTreeNode[];
};

type Props = {
  activeId?: string | null;
  ariaLabel: string;
  className?: string;
  defaultOpenIds?: string[];
  nodes: FileTreeNode[];
  onSelect?: (id: string) => void;
  testId?: string;
};

function hasChildren(node: FileTreeNode) {
  return Boolean(node.children?.length);
}

function collectDefaultOpenIds(nodes: FileTreeNode[], explicitIds: string[] | undefined) {
  if (explicitIds) {
    return explicitIds;
  }

  return nodes.filter(hasChildren).map((node) => node.id);
}

export function FileTree({ activeId, ariaLabel, className, defaultOpenIds, nodes, onSelect, testId }: Props) {
  const [openIds, setOpenIds] = useState(() => new Set(collectDefaultOpenIds(nodes, defaultOpenIds)));

  const toggleOpen = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderNode = (node: FileTreeNode, depth: number) => {
    const Icon = node.icon ?? Folder;
    const open = openIds.has(node.id);
    const expandable = hasChildren(node);

    return (
      <div className="grid gap-0.5" key={node.id}>
        <Button
          className={cn(
            "grid h-auto min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent/60",
            node.statusLabel ? "grid-cols-[14px_16px_minmax(0,1fr)_auto_8px]" : "grid-cols-[14px_16px_minmax(0,1fr)_8px]",
            activeId === node.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : null
          )}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          variant="ghost"
          role="treeitem"
          tabIndex={0}
          aria-expanded={expandable ? open : undefined}
          aria-label={node.ariaLabel ?? node.label}
          onClick={() => {
            if (expandable) {
              toggleOpen(node.id);
              return;
            }

            onSelect?.(node.id);
          }}
        >
          {expandable ? (
            open ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />
          ) : (
            <span className="size-3.5" />
          )}
          <Icon className="size-4 text-muted" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-sidebar-foreground">{node.label}</span>
            {node.detail ? <span className="block truncate text-[11px] text-muted">{node.detail}</span> : null}
          </span>
          {node.statusLabel ? <span className="text-[10px] font-bold uppercase text-muted">{node.statusLabel}</span> : null}
          {node.statusTone ? <span className={cn("size-2 rounded-full", node.statusTone)} aria-hidden="true" /> : <span />}
        </Button>
        {expandable && open ? (
          <div className="ml-[15px] grid gap-0.5 border-l border-sidebar-border pl-1">
            {node.children?.map((child) => renderNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={cn("grid gap-0.5 text-xs", className)} data-testid={testId} role="tree" aria-label={ariaLabel}>
      {nodes.map((node) => renderNode(node, 0))}
    </div>
  );
}
