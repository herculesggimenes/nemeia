import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nemeia Documentation",
  description: "Understand the Nemeia World Runtime, entity-component model, interactions, actions, and live robot projection."
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
