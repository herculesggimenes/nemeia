"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useRef, useState } from "react";
import { Send } from "lucide-react";
import { threadItems } from "../lib/mock-data";
import type { ThreadItem } from "../lib/types";
import { LmnrChatThread } from "../features/thread/lmnr-chat-thread";

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
    <section className="thread">
      <div className="mobileThreadHeader">
        <span>Conversation</span>
      </div>

      <div className="threadList">
        <LmnrChatThread items={items} />
      </div>

      <form className="promptBox" onSubmit={onSubmit}>
        <textarea
          aria-label="Ask Nemeia"
          name="message"
          ref={draftRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onPromptKeyDown}
          placeholder="Ask Nemeia..."
          rows={2}
        />
        <div className="promptActions">
          <span>Shift+Enter for newline</span>
          <button type="button" onClick={submitDraft} aria-label="Send message">
            <Send size={15} />
          </button>
        </div>
      </form>
    </section>
  );
}
