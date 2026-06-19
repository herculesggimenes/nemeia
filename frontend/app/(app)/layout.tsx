import { AppShell } from "../../components/layout/app-shell";

export default function NemeiaAppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
