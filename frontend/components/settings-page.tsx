import Link from "next/link";

export function SettingsPage() {
  return (
    <section className="h-full min-h-0 overflow-auto p-6" aria-label="Settings" data-testid="settings-page">
      <div className="max-w-2xl space-y-4">
        <Link className="text-sm underline underline-offset-4" href="/missions">Mission board</Link>
        <h1 className="text-base font-semibold">Settings</h1>
        <p className="text-sm text-muted">Operator credentials remain in this tab’s memory. Connect from the mission board; this page does not start a robot connection or change device settings.</p>
      </div>
    </section>
  );
}
