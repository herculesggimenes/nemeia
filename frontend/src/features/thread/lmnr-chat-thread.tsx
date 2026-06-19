import {
  Bot,
  Boxes,
  ChevronRight,
  Cpu,
  MessagesSquare,
  RadioTower
} from "lucide-react";
import { useState } from "react";
import type { ThreadItem, ThreadItemKind } from "../../lib/types";
import { cn } from "../../lib/utils";

type Props = {
  items: ThreadItem[];
};

const iconForKind: Record<ThreadItemKind, typeof MessagesSquare> = {
  user: MessagesSquare,
  assistant: Bot,
  component_event: RadioTower,
  tool_call: Cpu,
  artifact: Boxes
};

const labelForKind: Record<ThreadItemKind, string> = {
  user: "user",
  assistant: "assistant",
  component_event: "event",
  tool_call: "tool",
  artifact: "artifact"
};

function previewForItem(item: ThreadItem) {
  const source = item.source ? ` · ${item.source}` : "";
  return `${item.body}${source}`;
}

function ThreadPart({ item }: { item: ThreadItem }) {
  if (item.kind === "tool_call") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-surface-3 bg-surface-0 px-3 py-2 text-sm">
        <Cpu size={13} />
        <code className="font-mono text-foreground">{item.body}</code>
      </div>
    );
  }

  if (item.kind === "component_event") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-primary/60 bg-surface-0 px-3 py-2 text-sm">
        <RadioTower size={13} />
        <div>
          <p className="m-0 leading-5 text-foreground">{item.body}</p>
          {item.source ? <small className="mt-1 block text-xs text-primary">{item.source}</small> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="text-sm leading-6">
      <p className="m-0">{item.body}</p>
      {item.source ? <small className="mt-1 block text-xs text-muted">{item.source}</small> : null}
    </div>
  );
}

function LmnrChatMessage({
  item
}: {
  item: ThreadItem;
}) {
  const [open, setOpen] = useState(false);
  const Icon = iconForKind[item.kind];
  const isUser = item.kind === "user";
  const isEvent = item.kind === "component_event";

  return (
    <article
      className={cn(
        "w-full rounded-lg border bg-surface-2/75 text-foreground transition-colors hover:border-surface-5",
        isUser ? "ml-auto max-w-[72%] border-secondary/70 bg-secondary/15" : "max-w-full border-surface-3",
        isEvent ? "border-primary/70" : null
      )}
      data-testid="thread-message"
      data-kind={item.kind}
      data-open={open}
    >
      <div className={cn("grid grid-cols-[24px_24px_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2", isUser ? "text-right" : null)}>
        <button
          className="grid size-6 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
          aria-label="Toggle message"
          type="button"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open ? "rotate-90" : null)} />
        </button>
        <div
          className={cn(
            "grid size-6 place-items-center rounded-md bg-surface-3 text-primary",
            isUser ? "bg-secondary/30 text-secondary" : null
          )}
        >
          <Icon size={14} />
        </div>
        <div className="min-w-0">
          <div className={cn("flex items-center gap-2", isUser ? "justify-end" : null)}>
            <strong className="text-sm font-extrabold">{item.title}</strong>
            <span className="text-xs text-muted">{labelForKind[item.kind]}</span>
          </div>
          <p
            className={cn(
              "mt-1 max-h-[3.75rem] overflow-hidden text-sm leading-5 text-foreground",
              open ? "hidden" : "block"
            )}
          >
            {previewForItem(item)}
          </p>
        </div>
        <time className="text-xs text-muted">{item.time}</time>
      </div>

      {open ? (
        <div className={cn("px-12 pb-3", isUser ? "text-right text-foreground" : null)}>
          <ThreadPart item={item} />
        </div>
      ) : null}
    </article>
  );
}

export function LmnrChatThread({ items }: Props) {
  return (
    <div className="flex flex-col gap-3" data-testid="thread-messages">
      {items.map((item) => (
        <LmnrChatMessage
          item={item}
          key={item.id}
        />
      ))}
    </div>
  );
}
