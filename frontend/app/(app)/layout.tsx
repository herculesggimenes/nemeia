import { AppShell } from "../../src/app-shell/app-shell";

export default function NemeiaAppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
