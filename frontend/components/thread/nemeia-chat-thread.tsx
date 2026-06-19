import {
  Bot,
  Boxes,
  ChevronRight,
  Cpu,
  MessagesSquare,
  RadioTower
} from "lucide-react";
import { useState } from "react";
import type { ThreadItem, ThreadItemKind } from "../../types/nemeia";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

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
      <Card className="flex items-center gap-3 rounded-md bg-surface-0 px-3 py-2 text-sm">
        <Cpu size={13} />
        <code className="font-mono text-foreground">{item.body}</code>
      </Card>
    );
  }

  if (item.kind === "component_event") {
    return (
      <Card className="flex items-start gap-3 rounded-md border-primary/60 bg-surface-0 px-3 py-2 text-sm">
        <RadioTower size={13} />
        <div>
          <p className="m-0 leading-5 text-foreground">{item.body}</p>
          {item.source ? <small className="mt-1 block text-xs text-primary">{item.source}</small> : null}
        </div>
      </Card>
    );
  }

  return (
    <div className="text-sm leading-6">
      <p className="m-0">{item.body}</p>
      {item.source ? <small className="mt-1 block text-xs text-muted">{item.source}</small> : null}
    </div>
  );
}

function NemeiaChatMessage({
  item
}: {
  item: ThreadItem;
}) {
  const [open, setOpen] = useState(false);
  const Icon = iconForKind[item.kind];
  const isUser = item.kind === "user";
  const isEvent = item.kind === "component_event";

  return (
    <Card
      as="article"
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
        <Button
          className="size-6"
          variant="icon"
          size="icon"
          onClick={() => setOpen((value) => !value)}
          aria-label="Toggle message"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open ? "rotate-90" : null)} />
        </Button>
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
            <Badge className="border-0 px-0 font-normal" variant="outline">{labelForKind[item.kind]}</Badge>
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
    </Card>
  );
}

export function NemeiaChatThread({ items }: Props) {
  return (
    <div className="flex flex-col gap-3" data-testid="thread-messages">
      {items.map((item) => (
        <NemeiaChatMessage
          item={item}
          key={item.id}
        />
      ))}
    </div>
  );
}
