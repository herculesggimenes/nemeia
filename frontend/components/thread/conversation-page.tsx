"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useRef, useState } from "react";
import { Send } from "lucide-react";
import { threadItems } from "../../lib/mock-data";
import type { ThreadItem } from "../../types/nemeia";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { NemeiaChatThread } from "./nemeia-chat-thread";

function clockTime() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ConversationPage() {
  const [items, setItems] = useState<ThreadItem[]>(threadItems);
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  const sendMessage = (body: string) => {
    const text = body.trim();
    if (!text) {
      return;
    }

    const time = clockTime();
    setItems((current) => [
      ...current,
      {
        id: `user_${Date.now()}`,
        kind: "user",
        title: "Operator",
        body: text,
        time
      },
      {
        id: `assistant_${Date.now()}`,
        kind: "assistant",
        title: "Nemeia",
        body: `Mock response queued for: "${text}". The runtime would now decide whether to call bash, inspect artifacts, or wait for component events.`,
        time: clockTime()
      }
    ]);
    setDraft("");
  };

  const submitDraft = () => {
    sendMessage(draftRef.current?.value ?? draft);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitDraft();
  };

  const onPromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden px-5 py-3 md:px-8">
      <div className="border-b border-surface-3 px-3 py-2 text-xs font-extrabold text-foreground md:hidden">
        <span>Conversation</span>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-2 overflow-auto px-0 py-5">
        <NemeiaChatThread items={items} />
      </div>

      <form
        className="mx-auto mb-3 grid h-28 w-full max-w-4xl shrink-0 grid-rows-[1fr_auto] rounded-lg border border-surface-4 bg-surface-2/95 p-3 focus-within:border-primary"
        onSubmit={onSubmit}
      >
        <Textarea
          className="h-full min-h-0 border-0 bg-transparent p-0"
          aria-label="Ask Nemeia"
          name="message"
          ref={draftRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onPromptKeyDown}
          placeholder="Ask Nemeia..."
          rows={2}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted">Shift+Enter for newline</span>
          <Button
            className="size-8"
            size="icon"
            onClick={submitDraft}
            aria-label="Send message"
          >
            <Send size={15} />
          </Button>
        </div>
      </form>
    </section>
  );
}
