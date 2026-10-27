import Link from "next/link";
import { ArrowDownWideNarrow, ChevronDown, Folder, ListFilter, Plus, Search, Workflow } from "lucide-react";
import BadgeSoon from "@/components/BadgeSoon";
import CardAutomation from "@/components/CardAutomation";
import HeaderPage from "@/components/HeaderPage";
import StateEmpty from "@/components/StateEmpty";
import { Button } from "@/components/ui/button";
import { runDashboardAction } from "@/lib/actions/dashboard";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { cn } from "@/lib/utils";

export const metadata = { title: "Automations" };

const TABS = [
	{ id: "workflows", label: "Workflows" },
	{ id: "drafts", label: "Drafts" },
];

// Workflows: the automations that started, running or paused. Drafts: never started.
export default async function AutomationsPage({ searchParams }) {
	const [{ tab }, { selected }] = await Promise.all([searchParams, getSelectedNewsletter()]);
	const { output } = selected ? await runDashboardAction("list_automations", { newsletter: String(selected._id) }) : { output: null };
	const automations = output?.automations ?? [];
	const groups = {
		workflows: automations.filter(({ status }) => status !== "draft"),
		drafts: automations.filter(({ status }) => status === "draft"),
	};
	const current = tab === "drafts" ? "drafts" : "workflows";
	const shown = groups[current];

	return (
		<>
			<HeaderPage title="Automations">
				<Button asChild>
					<Link href="/automations/new">
						<Plus data-icon="inline-start" />
						New automation
					</Link>
				</Button>
			</HeaderPage>

			<nav aria-label="Automations" className="mb-6 flex gap-6 border-b border-border/60 animate-enter">
				{TABS.map(({ id, label }) => (
					<Link
						key={id}
						href={id === "workflows" ? "/automations" : `/automations?tab=${id}`}
						aria-current={current === id ? "page" : undefined}
						className={cn(
							"-mb-px flex items-center gap-2 border-b-2 pb-2.5 text-sm font-medium transition-colors duration-150",
							current === id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
						)}
					>
						{label}
						<span className="rounded-md bg-muted px-1.5 text-xs tabular-nums">{groups[id].length}</span>
					</Link>
				))}
			</nav>

			{shown.length === 0 ? (
				<StateEmpty icon={Workflow} title={current === "drafts" ? "No drafts" : "No automations yet"} />
			) : (
				<div className="overflow-hidden rounded-xl shadow-border animate-enter">
					<div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3">
						<label className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
							<input type="checkbox" disabled aria-label="Select all" />
							Select all
						</label>
						<DisabledTool icon={ListFilter} label="Filter" />
						<DisabledTool icon={Folder} label="All" />
						<div className="ml-auto flex items-center gap-2">
							<DisabledTool icon={Search} label="Search automation" />
							<DisabledTool icon={ArrowDownWideNarrow} label="Date created" />
						</div>
					</div>
					<ul className="divide-y divide-border/60">
						{shown.map((automation) => (
							<CardAutomation key={automation.id} automation={automation} />
						))}
					</ul>
				</div>
			)}
		</>
	);
}

function DisabledTool({ icon: Icon, label }) {
	return (
		<Button variant="outline" size="sm" disabled>
			<Icon data-icon="inline-start" />
			{label}
			<ChevronDown data-icon="inline-end" />
			<BadgeSoon className="ml-1" />
		</Button>
	);
}
