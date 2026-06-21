"use client";

import { hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { ChevronDown, ChevronRight, Folder, Settings } from "lucide-react";
import type { ComponentType, KeyboardEvent } from "react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export type FileTreeNode = {
  id: string;
  label: string;
  ariaLabel?: string;
  actionIcon?: ComponentType<{ className?: string; size?: number }>;
  actionId?: string;
  actionLabel?: string;
  settingsId?: string;
  settingsLabel?: string;
  detail?: string;
  statusLabel?: string;
  icon?: ComponentType<{ className?: string; size?: number }>;
  children?: FileTreeNode[];
};

type TreeItemData = FileTreeNode & {
  childrenIds: string[];
};

type Props = {
  activeId?: string | null;
  ariaLabel: string;
  className?: string;
  defaultOpenIds?: string[];
  nodes: FileTreeNode[];
  onAction?: (id: string) => void;
  onOpenSettings?: (id: string) => void;
  onSelect?: (id: string) => void;
  testId?: string;
};

function hasChildren(node: FileTreeNode) {
  return Boolean(node.children?.length);
}

function flattenTree(nodes: FileTreeNode[]) {
  const items: Record<string, TreeItemData> = {
    root: {
      childrenIds: nodes.map((node) => node.id),
      id: "root",
      label: "root"
    }
  };

  const visitNode = (node: FileTreeNode) => {
    items[node.id] = {
      ...node,
      childrenIds: node.children?.map((child) => child.id) ?? []
    };
    node.children?.forEach(visitNode);
  };

  nodes.forEach(visitNode);

  return items;
}

function collectFolderIds(nodes: FileTreeNode[]) {
  const ids: string[] = [];

  const visitNode = (node: FileTreeNode) => {
    if (hasChildren(node)) {
      ids.push(node.id);
      node.children?.forEach(visitNode);
    }
  };

  nodes.forEach(visitNode);

  return ids;
}

function collectDefaultOpenIds(nodes: FileTreeNode[], explicitIds: string[] | undefined) {
  if (explicitIds) {
    return explicitIds;
  }

  return collectFolderIds(nodes);
}

export function FileTree({ activeId, ariaLabel, className, defaultOpenIds, nodes, onAction, onOpenSettings, onSelect, testId }: Props) {
  const flattenedItems = useMemo(() => flattenTree(nodes), [nodes]);
  const defaultExpandedItems = useMemo(() => collectDefaultOpenIds(nodes, defaultOpenIds), [defaultOpenIds, nodes]);
  const [expandedItems, setExpandedItems] = useState(defaultExpandedItems);
  const [selectedItems, setSelectedItems] = useState<string[]>(activeId ? [activeId] : []);

  const tree = useTree<TreeItemData>({
    dataLoader: {
      getChildren: (itemId) => flattenedItems[itemId]?.childrenIds ?? [],
      getItem: (itemId) => flattenedItems[itemId]
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
    getItemName: (item) => item.getItemData().label,
    indent: 10,
    initialState: { expandedItems: defaultExpandedItems },
    isItemFolder: (item) => item.getItemData().childrenIds.length > 0,
    onPrimaryAction: (item) => {
      const node = item.getItemData();
      if (item.isFolder()) {
        if (item.isExpanded()) {
          item.collapse();
        } else {
          item.expand();
        }
        return;
      }

      onSelect?.(node.id);
    },
    rootItemId: "root",
    setExpandedItems,
    setSelectedItems,
    state: {
      expandedItems,
      selectedItems: activeId ? [activeId] : selectedItems
    }
  });

  const renderItem = (item: ReturnType<typeof tree.getItems>[number]) => {
    const node = item.getItemData();
    const Icon = node.icon ?? Folder;
    const ActionIcon = node.actionIcon;
    const expandable = item.isFolder();
    const open = item.isExpanded();
    const { key: _headlessTreeKey, ...itemProps } = item.getProps() as React.HTMLAttributes<HTMLDivElement> & { key?: string };

    return (
      <div
        key={item.getId()}
        {...itemProps}
        aria-label={node.ariaLabel ?? node.label}
        className={cn(
          "group/tree-node flex min-h-6 min-w-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-left text-xs outline-none hover:bg-sidebar-accent/60 focus-visible:ring-1 focus-visible:ring-ring",
          item.isFocused() ? "bg-sidebar-accent/80 text-sidebar-accent-foreground" : null,
          activeId === node.id || item.isSelected() ? "bg-sidebar-accent text-sidebar-accent-foreground" : null
        )}
        onClick={() => {
          item.setFocused();
          if (expandable) {
            if (open) {
              item.collapse();
            } else {
              item.expand();
            }
            return;
          }

          onSelect?.(node.id);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          itemProps.onKeyDown?.(event);
          if (event.key === "Enter") {
            event.preventDefault();
            item.primaryAction();
          }
        }}
        role="treeitem"
        style={{ paddingLeft: `${6 + item.getItemMeta().level * 10}px` }}
        tabIndex={item.isFocused() ? 0 : -1}
      >
        {expandable ? (
          open ? <ChevronDown className="size-3.5 shrink-0 text-muted" /> : <ChevronRight className="size-3.5 shrink-0 text-muted" />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <Icon className="size-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sidebar-foreground">{node.label}</span>
          {node.detail ? <span className="block max-w-full truncate text-[10px] leading-3 text-muted">{node.detail}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {node.actionId && ActionIcon ? (
            <Button
              className="size-[18px]"
              variant="icon"
              size="iconSm"
              aria-label={node.actionLabel ?? node.actionId}
              onClick={(event) => {
                event.stopPropagation();
                onAction?.(node.actionId ?? node.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onAction?.(node.actionId ?? node.id);
                }
              }}
            >
              <ActionIcon size={13} />
            </Button>
          ) : null}
          {node.settingsId ? (
            <Button
              className="size-[18px] opacity-0 group-hover/tree-node:opacity-100"
              variant="icon"
              size="iconSm"
              aria-label={node.settingsLabel ?? `${node.label} settings`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenSettings?.(node.settingsId ?? node.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenSettings?.(node.settingsId ?? node.id);
                }
              }}
            >
              <Settings size={13} />
            </Button>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <div {...tree.getContainerProps(ariaLabel)} className={cn("grid gap-0.5 text-xs", className)} data-testid={testId}>
      {tree.getItems().map(renderItem)}
    </div>
  );
}
