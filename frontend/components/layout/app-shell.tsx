/** Native routes share only layout, never a robot runtime or command port. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return <main className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">{children}</main>;
}
