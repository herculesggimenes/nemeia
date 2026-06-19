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
      <div className="lmnrMessagePart toolPart">
        <Cpu size={13} />
        <code>{item.body}</code>
      </div>
    );
  }

  if (item.kind === "component_event") {
    return (
      <div className="lmnrMessagePart eventPart">
        <RadioTower size={13} />
        <div>
          <p>{item.body}</p>
          {item.source ? <small>{item.source}</small> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="lmnrMessagePart textPart">
      <p>{item.body}</p>
      {item.source ? <small>{item.source}</small> : null}
    </div>
  );
}

function LmnrChatMessage({
  item
}: {
  item: ThreadItem;
}) {
  const [open, setOpen] = useState(true);
  const Icon = iconForKind[item.kind];

  return (
    <article className={`lmnrMessage ${item.kind} ${open ? "open" : "closed"}`}>
      <div className="lmnrMessageHeader">
        <button className="lmnrCollapse" onClick={() => setOpen((value) => !value)} aria-label="Toggle message">
          <ChevronRight size={14} />
        </button>
        <div className="lmnrRoleIcon">
          <Icon size={14} />
        </div>
        <div className="lmnrRole">
          <div className="lmnrRoleMeta">
            <strong>{item.title}</strong>
            <span>{labelForKind[item.kind]}</span>
          </div>
          <p>{previewForItem(item)}</p>
        </div>
        <time>{item.time}</time>
      </div>

      {open ? (
        <div className="lmnrMessageBody">
          <ThreadPart item={item} />
        </div>
      ) : null}
    </article>
  );
}

export function LmnrChatThread({ items }: Props) {
  return (
    <div className="lmnrMessages">
      {items.map((item) => (
        <LmnrChatMessage
          item={item}
          key={item.id}
        />
      ))}
    </div>
  );
}
