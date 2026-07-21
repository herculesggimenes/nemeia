import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Box,
  Boxes,
  Braces,
  Camera,
  Check,
  ChevronRight,
  CircleDot,
  Cpu,
  FileCheck2,
  GitBranch,
  Layers3,
  Menu,
  MousePointerClick,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Terminal,
  TriangleAlert
} from "lucide-react";
import { coreObjects, docsSections, implementationStatus, nemInterfaces, runLifecycle } from "../../lib/docs/nemeia-docs-content";

function DocsMark() {
  return (
    <Link className="flex items-center gap-3" href="/docs" aria-label="Nemeia documentation home">
      <span className="grid h-8 w-20 place-items-center rounded-[4px] bg-black px-2">
        <Image src="/assets/nemeia-logo-white.svg" alt="Nemeia" width={84} height={18} priority />
      </span>
      <span className="h-5 w-px bg-zinc-200" />
      <span className="text-sm font-semibold text-zinc-800">Docs</span>
    </Link>
  );
}

function ArchitectureVisual() {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white" aria-label="Nemeia world interaction loop">
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
        <DiagramNode icon={Camera} label="Sense" detail="observations" />
        <ArrowRight className="hidden text-zinc-300 sm:block" size={18} />
        <DiagramNode icon={Box} label="Entities" detail="stable things" accent />
        <ArrowRight className="hidden text-zinc-300 sm:block" size={18} />
        <DiagramNode icon={Braces} label="Components" detail="state + ability" />
      </div>
      <div className="grid gap-3 border-t border-zinc-800 bg-zinc-950 p-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
        <DiagramNode dark icon={MousePointerClick} label="Affordances" detail="possible now" />
        <ArrowRight className="hidden text-zinc-700 sm:block" size={18} />
        <DiagramNode dark icon={Cpu} label="Action" detail="meaningful change" accent />
        <ArrowRight className="hidden text-zinc-700 sm:block" size={18} />
        <DiagramNode dark icon={RefreshCw} label="World update" detail="effects + events" />
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900"><RefreshCw size={14} />The updated world produces the next set of available interactions.</div>
    </div>
  );
}

function DiagramNode({ accent, dark, detail, icon: Icon, label }: { accent?: boolean; dark?: boolean; detail: string; icon: LucideIcon; label: string }) {
  return (
    <div className={`min-w-0 rounded-md border p-3 ${dark ? "border-zinc-800 bg-zinc-900" : accent ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-zinc-50"}`}>
      <div className="flex items-center gap-2">
        <Icon className={dark ? "text-emerald-400" : accent ? "text-emerald-300" : "text-zinc-500"} size={15} />
        <strong className={`truncate text-xs ${dark ? "text-white" : ""}`}>{label}</strong>
      </div>
      <div className={`mt-1 text-xs ${dark || accent ? "text-zinc-400" : "text-zinc-500"}`}>{detail}</div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-6">
          <DocsMark />
          <nav className="flex items-center gap-1 text-sm" aria-label="Primary navigation">
            <Link className="hidden rounded-md px-3 py-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 sm:block" href="/">
              Operator
            </Link>
            <a className="hidden rounded-md px-3 py-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 sm:block" href="#reference">
              Reference
            </a>
            <details className="group relative sm:hidden">
              <summary className="grid size-9 list-none cursor-pointer place-items-center rounded-md border border-zinc-200 text-zinc-600" aria-label="Open documentation navigation">
                <Menu size={17} />
              </summary>
              <nav className="absolute right-0 top-11 z-40 grid w-64 gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-xl" aria-label="Mobile documentation navigation">
                {docsSections.map((section) => (
                  <div key={section.label}>
                    <div className="mb-1 text-xs font-semibold text-zinc-950">{section.label}</div>
                    {section.items.map((item) => <a className="block py-1.5 text-sm text-zinc-600" href={item.href} key={item.href}>{item.label}</a>)}
                  </div>
                ))}
              </nav>
            </details>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[240px_minmax(0,760px)_200px] xl:grid-cols-[260px_minmax(0,820px)_220px]">
        <aside id="docs-navigation" className="hidden border-r border-zinc-200 px-6 py-8 lg:block">
          <nav className="sticky top-22 grid gap-7" aria-label="Documentation navigation">
            {docsSections.map((section) => (
              <div key={section.label}>
                <div className="mb-2 text-xs font-semibold text-zinc-950">{section.label}</div>
                <div className="grid gap-1">
                  {section.items.map((item) => (
                    <a className="rounded-md py-1.5 text-sm text-zinc-500 hover:text-zinc-950" href={item.href} key={item.href}>{item.label}</a>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 px-5 py-10 sm:px-10 lg:px-12 lg:py-14">
          <section id="overview" className="scroll-mt-24 border-b border-zinc-200 pb-12">
            <div className="mb-5 flex items-center gap-2 text-sm text-zinc-500">
              <BookOpen size={15} />
              World Runtime 0.1
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Core</span>
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">Nemeia Documentation</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-600">
              Nemeia turns real and simulated environments into interactive worlds made of entities, components, relationships, and actions.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800" href="#first-principle">
                Understand the framework <ArrowRight size={15} />
              </a>
              <a className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50" href="#current-status">
                See what is implemented
              </a>
            </div>
          </section>

          <section id="first-principle" className="scroll-mt-24 py-12">
            <SectionEyebrow icon={Boxes}>The mental model</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold">The Sims, as a framework for agents</h2>
            <div className="mt-6 border-l-2 border-zinc-950 py-2 pl-5 text-xl font-medium leading-8">
              What exists, what is it made of, and what can it do with everything else?
            </div>
            <p className="mt-5 leading-7 text-zinc-600">
              A robot, person, backpack, door, and room are all entities. Components describe their state and abilities. When components match, the runtime derives a meaningful interaction.
            </p>
          </section>

          <section id="architecture" className="scroll-mt-24 border-t border-zinc-200 py-12">
            <SectionEyebrow icon={Layers3}>Architecture</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold">One continuous world loop</h2>
            <p className="mt-3 max-w-2xl leading-7 text-zinc-600">
              Nemeia converts observations into entities, composes them from components, derives interactions, executes actions, and applies the results back to the world.
            </p>
            <div className="mt-7"><ArchitectureVisual /></div>
          </section>

          <section id="life-of-a-run" className="scroll-mt-24 border-t border-zinc-200 py-12">
            <SectionEyebrow icon={GitBranch}>The world loop</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold">From sensing to the next possible action</h2>
            <p className="mt-3 leading-7 text-zinc-600">The runtime continuously turns changing state into new interactions.</p>
            <div className="mt-7 grid">
              {runLifecycle.map(([title, detail], index) => (
                <div className="grid grid-cols-[34px_1fr] gap-3" key={title}>
                  <div className="grid grid-rows-[28px_1fr] justify-items-center">
                    <span className="grid size-7 place-items-center rounded-full border border-zinc-300 bg-white text-xs font-semibold">{index + 1}</span>
                    {index < runLifecycle.length - 1 ? <span className="w-px bg-zinc-200" /> : null}
                  </div>
                  <div className="pb-7">
                    <h3 className="text-sm font-semibold">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-zinc-600">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="core-objects" className="scroll-mt-24 border-t border-zinc-200 py-12">
            <SectionEyebrow icon={Boxes}>Core objects</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold">A small vocabulary for interactive worlds</h2>
            <p className="mt-3 leading-7 text-zinc-600">Each primitive answers one question and composes cleanly with the others.</p>
            <div className="mt-7 overflow-hidden rounded-lg border border-zinc-200">
              {coreObjects.map(([name, question], index) => (
                <div className={`grid gap-1 px-4 py-3 sm:grid-cols-[140px_1fr] ${index ? "border-t border-zinc-200" : ""}`} key={name}>
                  <code className="text-sm font-semibold text-zinc-950">{name}</code>
                  <span className="text-sm text-zinc-600">{question}</span>
                </div>
              ))}
            </div>
          </section>

          <section id="trust-model" className="scroll-mt-24 border-t border-zinc-200 py-12">
            <SectionEyebrow icon={Boxes}>Composition model</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold">Behavior emerges from composition</h2>
            <div className="mt-7 grid gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 sm:grid-cols-2">
              <TrustCell title="Identity" trust="Entity" detail="A stable thing that remains recognizable while its state changes." />
              <TrustCell title="State and ability" trust="Components" detail="Small pieces of data that can be added, updated, and removed." />
              <TrustCell title="Meaning between things" trust="Relationships" detail="Directed facts such as sees, near, inside, holding, or connected." />
              <TrustCell title="Behavior" trust="Actions + systems" detail="Interactions and continuous processes that transform world state." />
            </div>
          </section>

          <section id="interfaces" className="scroll-mt-24 border-t border-zinc-200 py-12">
            <SectionEyebrow icon={Braces}>Core interfaces</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold">The complete runtime in seven operations</h2>
            <p className="mt-3 leading-7 text-zinc-600">The first implementation is intentionally small enough to understand and test end to end.</p>
            <div className="mt-7 divide-y divide-zinc-200 border-y border-zinc-200">
              {nemInterfaces.map(([id, name, detail]) => (
                <div className="grid gap-2 py-4 sm:grid-cols-[72px_180px_1fr] sm:items-start" key={id}>
                  <code className="text-xs font-semibold text-zinc-500">{id}</code>
                  <div className="text-sm font-semibold">{name}</div>
                  <div className="text-sm leading-6 text-zinc-600">{detail}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="scroll-mt-24 border-t border-zinc-200 py-12" id="drivers">
            <SectionEyebrow icon={Cpu}>Build</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold">Bring any world into the same model</h2>
            <div className="mt-7 grid gap-4 sm:grid-cols-3">
              <BuildPath id="INPUT" icon={Camera} title="Sensor system" detail="Turn observations into entity and component updates." />
              <BuildPath id="BEHAVIOR" icon={MousePointerClick} title="Action pack" detail="Declare component requirements and implement the interaction." anchor="capabilities" />
              <BuildPath id="OUTPUT" icon={Cpu} title="Adapter" detail="Project simulation or hardware into standard components." anchor="clients" />
            </div>
            <div className="mt-7 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-100">
              <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2 text-xs text-zinc-400"><Terminal size={13} /> Terminal</div>
              <pre className="overflow-x-auto p-4 text-sm leading-6"><code>world.affordancesFor(
  &quot;robot_01&quot;,
  &quot;backpack_01&quot;
)</code></pre>
            </div>
          </section>

          <section id="current-status" className="scroll-mt-24 border-t border-zinc-200 py-12">
            <SectionEyebrow icon={Activity}>Current status</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold">Reference implementation status</h2>
            <p className="mt-3 leading-7 text-zinc-600">The core interaction loop is implemented. Live robot state now appears as entity components; semantic object ingestion and physical action packs are next.</p>
            <div className="mt-7 overflow-hidden rounded-lg border border-zinc-200">
              {implementationStatus.map(([name, status, detail], index) => {
                const done = status === "Implemented";
                return (
                  <div className={`grid gap-2 px-4 py-4 sm:grid-cols-[1fr_112px] ${index ? "border-t border-zinc-200" : ""}`} key={name}>
                    <div>
                      <div className="text-sm font-semibold">{name}</div>
                      <div className="mt-1 text-sm leading-6 text-zinc-600">{detail}</div>
                    </div>
                    <div className={`flex h-7 items-center gap-1.5 text-xs font-medium ${done ? "text-emerald-700" : "text-amber-700"}`}>
                      {done ? <Check size={14} /> : <TriangleAlert size={14} />}{status}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section id="conformance" className="scroll-mt-24 border-t border-zinc-200 py-12">
            <SectionEyebrow icon={FileCheck2}>Testing</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold">The world loop is testable without hardware</h2>
            <p className="mt-3 leading-7 text-zinc-600">Entity updates, relationship changes, affordance derivation, action effects, and event order are deterministic. Adapters can then be validated against live data.</p>
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <Metric label="Core operations" value="7" detail="The complete World Runtime surface" />
              <Metric label="Core tests" value="5" detail="Entities through deterministic snapshots" />
              <Metric label="Live robot" value="Next" detail="Read-only component validation" warning />
            </div>
          </section>

          <section id="reference" className="scroll-mt-24 border-t border-zinc-200 pt-12">
            <SectionEyebrow icon={ScrollText}>Reference</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold">Go deeper</h2>
            <div className="mt-7 grid gap-3">
              <ReferenceLink href="#interfaces" title="World Runtime interface" detail="The complete entity, component, relationship, affordance, action, and event surface." />
              <ReferenceLink href="#current-status" title="Implementation status" detail="Live projections, remaining perception work, and action-pack milestones." />
              <ReferenceLink href="/docs#governance-archive" title="Archived governance extension" detail="The previous Mission and Authorization work is preserved for optional future use." />
              <div className="border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950" id="governance-archive"><strong className="block">Optional extension, not core</strong><span className="mt-1 block">Authentication, authorization, policy, approvals, and signed mission execution remain in the repository as an archived experiment. They are not required by the World Runtime.</span></div>
              <Link className="group flex items-center justify-between rounded-lg border border-zinc-200 p-4 hover:border-zinc-400" href="/">
                <div><div className="text-sm font-semibold">Operator workbench</div><div className="mt-1 text-sm text-zinc-600">Operate the current runtime and inspect Mission state.</div></div>
                <ChevronRight className="text-zinc-400 group-hover:text-zinc-950" size={18} />
              </Link>
            </div>
          </section>
        </main>

        <aside className="hidden px-6 py-14 lg:block">
          <nav className="sticky top-22" aria-label="On this page">
            <div className="mb-3 text-xs font-semibold">On this page</div>
            <div className="grid gap-2 text-xs text-zinc-500">
              <a className="hover:text-zinc-950" href="#overview">Overview</a>
              <a className="hover:text-zinc-950" href="#architecture">Architecture</a>
              <a className="hover:text-zinc-950" href="#life-of-a-run">Life of a run</a>
              <a className="hover:text-zinc-950" href="#core-objects">Core objects</a>
              <a className="hover:text-zinc-950" href="#interfaces">Interfaces</a>
              <a className="hover:text-zinc-950" href="#current-status">Current status</a>
              <a className="hover:text-zinc-950" href="#reference">Reference</a>
            </div>
          </nav>
        </aside>
      </div>
    </div>
  );
}

function SectionEyebrow({ children, icon: Icon }: { children: React.ReactNode; icon: typeof ShieldCheck }) {
  return <div className="flex items-center gap-2 text-sm font-medium text-zinc-500"><Icon size={15} />{children}</div>;
}

function TrustCell({ detail, title, trust }: { detail: string; title: string; trust: string }) {
  return <div className="bg-white p-4"><div className="flex items-center gap-2 text-sm font-semibold"><CircleDot size={14} />{title}</div><div className="mt-3 text-xs font-semibold uppercase text-zinc-500">{trust}</div><p className="mt-1 text-sm leading-6 text-zinc-600">{detail}</p></div>;
}

function BuildPath({ anchor, detail, icon: Icon, id, title }: { anchor?: string; detail: string; icon: typeof Cpu; id: string; title: string }) {
  return <article className="rounded-lg border border-zinc-200 p-4" id={anchor}><div className="flex items-center justify-between"><Icon size={18} /><code className="text-xs text-zinc-500">{id}</code></div><h3 className="mt-5 text-sm font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-zinc-600">{detail}</p></article>;
}

function Metric({ detail, label, value, warning }: { detail: string; label: string; value: string; warning?: boolean }) {
  return <div className="rounded-lg border border-zinc-200 p-4"><div className="text-xs font-medium text-zinc-500">{label}</div><div className={`mt-3 text-2xl font-semibold ${warning ? "text-amber-700" : "text-zinc-950"}`}>{value}</div><div className="mt-2 text-xs leading-5 text-zinc-500">{detail}</div></div>;
}

function ReferenceLink({ detail, href, title }: { detail: string; href: string; title: string }) {
  return <a className="group flex items-center justify-between rounded-lg border border-zinc-200 p-4 hover:border-zinc-400" href={href}><div><div className="text-sm font-semibold">{title}</div><div className="mt-1 text-sm text-zinc-600">{detail}</div></div><ChevronRight className="text-zinc-400 group-hover:text-zinc-950" size={18} /></a>;
}
