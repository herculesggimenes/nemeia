import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Bot,
  Box,
  Boxes,
  Braces,
  Camera,
  Check,
  ChevronRight,
  CircleStop,
  Cpu,
  FileClock,
  Fingerprint,
  Gauge,
  GitBranch,
  MousePointerClick,
  RadioTower,
  RefreshCw,
  TriangleAlert,
  UserCheck
} from "lucide-react";
import { frameworkPrimitives, productionFeatures, runStory } from "../../lib/docs/framework-story-content";

const featureIcons = [UserCheck, Gauge, CircleStop, FileClock, Cpu, RadioTower];

function NemeiaMark() {
  return <Link href="/framework" aria-label="Nemeia framework home"><Image className="invert" src="/assets/nemeia-logo-white.svg" alt="Nemeia" width={92} height={20} priority /></Link>;
}

function HeroSystemVisual() {
  return (
    <div className="relative min-h-[360px] min-w-0 overflow-hidden border border-zinc-200 bg-zinc-50 p-5 sm:min-h-[430px] sm:p-8" aria-label="Sense, entities, components, actions, and world updates">
      <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(#e4e4e7_1px,transparent_1px),linear-gradient(90deg,#e4e4e7_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative mx-auto grid max-w-md gap-3">
        <FlowNode icon={Camera} label="Sense" detail="observations arrive" />
        <FlowArrow />
        <div className="grid grid-cols-2 gap-3">
          <FlowNode icon={Bot} label="Robot" detail="core.robot" />
          <FlowNode icon={Box} label="Backpack" detail="core.container" />
        </div>
        <FlowArrow />
        <div className="grid grid-cols-2 gap-3">
          <FlowNode icon={Braces} label="Locomotion" detail="component" dark />
          <FlowNode icon={Braces} label="Portable" detail="component" dark />
        </div>
        <FlowArrow />
        <FlowNode icon={MousePointerClick} label="Approach" detail="available interaction" active />
        <FlowArrow />
        <div className="flex items-center justify-center gap-2 text-xs font-medium text-zinc-600"><RefreshCw size={15} /> Update the world</div>
      </div>
      <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-900"><Boxes size={12} /> same model, simulation or reality</div>
    </div>
  );
}

function FlowNode({ active, dark, detail, icon: Icon, label }: { active?: boolean; dark?: boolean; detail: string; icon: typeof Bot; label: string }) {
  return <div className={`flex min-w-0 items-center justify-between gap-3 border p-3 ${active ? "border-emerald-300 bg-emerald-50" : dark ? "border-zinc-800 bg-zinc-950 text-white" : "border-zinc-200 bg-white"}`}><div className="flex min-w-0 items-center gap-2"><Icon className={`shrink-0 ${active ? "text-emerald-700" : dark ? "text-emerald-400" : "text-zinc-500"}`} size={16} /><strong className="truncate text-xs">{label}</strong></div><span className={`hidden shrink-0 text-[11px] sm:inline ${dark ? "text-zinc-400" : "text-zinc-500"}`}>{detail}</span></div>;
}

function FlowArrow() {
  return <ArrowDown className="mx-auto text-zinc-300" size={17} />;
}

function EntityInspector() {
  return (
    <div className="sticky top-24 overflow-hidden border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3"><div className="flex items-center gap-2 text-xs font-medium"><Box size={14} /> Entity inspector</div><span className="text-[11px] text-zinc-400">robot_01</span></div>
      <div className="p-4 font-mono text-xs leading-6 text-zinc-600">
        <div><span className="text-zinc-400">type</span> <span className="text-zinc-950">core.robot</span></div>
        <div><span className="text-zinc-400">components</span> <span className="text-zinc-950">7</span></div>
        <div><span className="text-zinc-400">connection</span> <span className="text-emerald-700">active</span></div>
      </div>
      <div className="grid grid-cols-3 border-t border-zinc-200 text-center text-[10px]">
        <PacketMetric label="components" value="7" />
        <PacketMetric label="relations" value="1" />
        <PacketMetric label="actions" value="5" />
      </div>
      <div className="border-t border-zinc-200 bg-zinc-950 p-4 text-xs text-zinc-300">
        <div className="mb-3 flex items-center justify-between"><span>Available interactions</span><span className="flex items-center gap-1 text-emerald-400"><Check size={12} /> derived now</span></div>
        <div className="flex flex-wrap gap-2 text-[10px]"><span className="border border-zinc-700 px-2 py-1">Observe</span><span className="border border-zinc-700 px-2 py-1">Map</span><span className="border border-zinc-700 px-2 py-1">Move</span><span className="border border-zinc-700 px-2 py-1">Stop</span></div>
      </div>
    </div>
  );
}

function PacketMetric({ label, value }: { label: string; value: string }) {
  return <div className="border-r border-zinc-200 p-3 last:border-r-0"><div className="font-semibold text-zinc-950">{value}</div><div className="mt-1 text-zinc-400">{label}</div></div>;
}

export default function FrameworkPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-950">
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-5 sm:px-8">
          <NemeiaMark />
          <nav className="flex items-center gap-1 text-sm" aria-label="Framework navigation">
            <Link className="hidden px-3 py-2 text-zinc-600 hover:text-zinc-950 sm:block" href="/docs">Docs</Link>
            <Link className="hidden px-3 py-2 text-zinc-600 hover:text-zinc-950 sm:block" href="/">Operator</Link>
            <a className="inline-flex h-8 items-center gap-1 bg-zinc-950 px-3 text-xs font-medium text-white" href="#get-started">Get started <ArrowRight size={13} /></a>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid min-h-[690px] max-w-[1440px] grid-cols-[minmax(0,1fr)] items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:py-24">
          <div className="min-w-0 max-w-xl">
            <div className="mb-7 flex items-center gap-2 text-xs font-medium text-zinc-500"><Fingerprint size={15} /> World Runtime 0.1</div>
            <h1 className="text-5xl font-semibold leading-[1.03] sm:text-6xl">The framework for interactive physical worlds</h1>
            <div className="mt-7 flex w-fit border border-zinc-200 text-xs"><a className="bg-zinc-950 px-3 py-2 text-white" href="#operators">For agents</a><a className="px-3 py-2 text-zinc-600" href="#builders">For builders</a></div>
            <div className="mt-5 flex max-w-xl items-start gap-3 overflow-x-auto border border-zinc-200 bg-zinc-50 px-4 py-3 font-mono text-xs"><span className="text-zinc-400">$</span><code className="whitespace-nowrap">world.affordancesFor(&quot;robot_01&quot;, &quot;backpack_01&quot;)</code></div>
            <p className="mt-6 max-w-lg text-base leading-7 text-zinc-600">Like The Sims for AI agents. Turn real and simulated environments into entities, components, relationships, and meaningful actions.</p>
            <div className="mt-7 flex gap-3"><a className="inline-flex h-10 items-center gap-2 bg-zinc-950 px-4 text-sm font-medium text-white" href="#how-it-works">See how it works <ArrowRight size={15} /></a><Link className="inline-flex h-10 items-center px-4 text-sm font-medium text-zinc-600" href="/docs">Read the docs</Link></div>
          </div>
          <HeroSystemVisual />
        </section>

        <section className="border-t border-zinc-200" id="how-it-works">
          <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:py-28">
            <div className="grid gap-8 lg:grid-cols-2"><h2 className="max-w-md text-3xl font-semibold sm:text-4xl">An entity is a set of components</h2><p className="max-w-xl leading-7 text-zinc-600">Components describe what something is, what state it is in, and what it can do. Matching components create interactions between entities.</p></div>
            <div className="mt-20 grid gap-14 lg:grid-cols-[1fr_480px]">
              <div className="grid gap-24">
                {runStory.map(([number, title, detail]) => <article className="max-w-xl" key={number}><div className="mb-4 text-xs font-mono text-zinc-400">[ {number} ]</div><h3 className="text-xl font-medium">{title}</h3><p className="mt-3 leading-7 text-zinc-600">{detail}</p></article>)}
              </div>
              <EntityInspector />
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-200" id="builders">
          <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:py-28">
            <div className="grid gap-8 lg:grid-cols-2"><h2 className="max-w-lg text-3xl font-semibold sm:text-4xl">One world model, endlessly composable</h2><p className="max-w-xl leading-7 text-zinc-600">The same entity and action meaning works in a game, simulator, browser, or physical machine. Only the component implementation changes.</p></div>
            <div className="mt-14 grid border-l border-t border-zinc-200 sm:grid-cols-2 lg:grid-cols-3">
              {frameworkPrimitives.map(([name, role, detail], index) => { const Icon = [Boxes, Box, Braces, GitBranch, MousePointerClick, RefreshCw][index]; return <article className="min-h-52 border-b border-r border-zinc-200 p-5" key={name}><Icon size={18} /><h3 className="mt-10 text-sm font-semibold">{name}</h3><div className="mt-2 text-xs font-medium uppercase text-zinc-400">{role}</div><p className="mt-3 text-sm leading-6 text-zinc-600">{detail}</p></article>; })}
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-200" id="operators">
          <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:py-28">
            <div className="grid gap-8 lg:grid-cols-2"><h2 className="max-w-lg text-3xl font-semibold sm:text-4xl">Everything agents need to inhabit a world</h2><p className="max-w-xl leading-7 text-zinc-600">Sensing, semantic state, available interactions, execution, and world updates share one small composable model.</p></div>
            <div className="mt-14 grid border-l border-t border-zinc-200 sm:grid-cols-2 lg:grid-cols-3">
              {productionFeatures.map(([name, detail], index) => { const Icon = featureIcons[index]; return <article className="min-h-48 border-b border-r border-zinc-200 p-5" key={name}><Icon className="text-zinc-500" size={18} /><h3 className="mt-10 text-sm font-semibold">{name}</h3><p className="mt-3 text-sm leading-6 text-zinc-600">{detail}</p></article>; })}
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-200">
          <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1.2fr] lg:py-28">
            <div><div className="text-xs font-mono text-zinc-400">CURRENT STATUS</div><h2 className="mt-4 text-3xl font-semibold sm:text-4xl">The core loop is working</h2><p className="mt-5 max-w-lg leading-7 text-zinc-600">The World Runtime and live robot projection are implemented. Next comes semantic object ingestion and supervised physical action packs.</p></div>
            <div className="border border-zinc-200">
              <StatusRow icon={Check} label="Entities, components, relations, affordances" status="Implemented" />
              <StatusRow icon={Check} label="Live robot component projection and World panel" status="Implemented" />
              <StatusRow icon={TriangleAlert} label="Semantic objects and physical action packs" status="Next" pending />
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-200" id="get-started">
          <div className="mx-auto flex min-h-[360px] max-w-[1440px] flex-col justify-between gap-12 px-5 py-16 sm:px-8 lg:flex-row lg:items-start lg:py-24">
            <h2 className="max-w-3xl text-4xl font-semibold sm:text-6xl">Build your first interactive world</h2>
            <div className="grid gap-3"><Link className="inline-flex h-10 items-center justify-center gap-2 bg-zinc-950 px-4 text-sm font-medium text-white" href="/">Open operator <ChevronRight size={15} /></Link><Link className="inline-flex h-10 items-center justify-center gap-2 border border-zinc-200 px-4 text-sm font-medium" href="/docs">Read documentation</Link></div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200"><div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-8 text-xs text-zinc-500 sm:px-8"><NemeiaMark /><span>Sense · compose · interact · update</span></div></footer>
    </div>
  );
}

function StatusRow({ icon: Icon, label, pending, status }: { icon: typeof Check; label: string; pending?: boolean; status: string }) {
  return <div className="flex items-center justify-between gap-4 border-b border-zinc-200 p-4 last:border-b-0"><div className="flex items-center gap-3 text-sm"><Icon className={pending ? "text-amber-600" : "text-emerald-600"} size={16} />{label}</div><span className={`text-xs font-medium ${pending ? "text-amber-700" : "text-emerald-700"}`}>{status}</span></div>;
}
