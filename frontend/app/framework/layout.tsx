import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nemeia - The Framework for Interactive Physical Worlds",
  description: "A vendor-neutral world runtime for entities, components, relationships, and actions across physical and simulated environments."
};

export default function FrameworkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
