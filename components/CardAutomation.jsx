"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Copy, Loader2, MoreHorizontal, Pause, PenLine, Play, Trash2, Workflow } from "lucide-react";
import { deleteAutomation, duplicateAutomation, setAutomationActive } from "@/app/(app)/automations/actions";
import BadgeStatus from "@/components/BadgeStatus";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatNumber } from "@/lib/format";
import { toast } from "@/lib/toast";

const STATUS_LABELS = { draft: "Draft", active: "Active", paused: "Inactive" };

// One automation in the list: what starts it, how many contacts are in it and went through, and its switch.
export default function CardAutomation({ automation }) {
	const [isWorking, startWorking] = useTransition();
	const { id, name, status, counts } = automation;
	const isActive = status === "active";

	function run(work) {
		startWorking(async () => {
			const result = await work();
			if (result?.error) toast.error(result.error);
		});
	}

	function remove() {
		if (!window.confirm(`Delete "${name}"? Contacts in it leave where they are.`)) return;
		run(() => deleteAutomation(id, { stay: true }));
	}

	return (
		<li className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6">
			<div className="grid size-20 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground max-sm:hidden">
				<Workflow className="size-6" />
			</div>
			<div className="flex min-w-0 flex-1 flex-col items-start gap-1">
				<BadgeStatus status={isActive ? "active" : status === "paused" ? "paused" : "draft"} label={STATUS_LABELS[status]} />
				<Link href={`/automations/${id}`} className="max-w-full truncate font-medium after:absolute after:inset-0">
					{name}
				</Link>
				<p className="text-sm text-muted-foreground">Created {automation.createdAt.slice(0, 10)}</p>
				<p className="max-w-full truncate text-sm">{automation.triggerDescription}</p>
				<div className="relative z-10 mt-2 flex items-center gap-2">
					{status !== "draft" && (
						<Button size="sm" variant="secondary" disabled={isWorking} onClick={() => run(() => setAutomationActive(id, !isActive))}>
							{isWorking ? <Loader2 data-icon="inline-start" className="animate-spin" /> : isActive ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
							{isActive ? "Pause" : "Activate"}
						</Button>
					)}
					<Button size="sm" variant="outline" asChild>
						<Link href={`/automations/${id}`}>Edit</Link>
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="icon-sm" aria-label={`Actions for ${name}`} disabled={isWorking}>
								<MoreHorizontal />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="min-w-44">
							<DropdownMenuItem asChild>
								<Link href={`/automations/${id}`}>
									<PenLine />
									Edit
								</Link>
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => run(() => duplicateAutomation(id))}>
								<Copy />
								Duplicate
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onSelect={remove}>
								<Trash2 />
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			<dl className="grid grid-cols-2 gap-6 text-sm sm:w-72 sm:shrink-0">
				<Count label="In progress" value={counts.waiting} tone="border-emerald-500" />
				<Count label="Completed" value={counts.completed} tone="border-sky-500" />
			</dl>
		</li>
	);
}

function Count({ label, value, tone }) {
	return (
		<div className={`border-l-2 pl-3 ${tone}`}>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="mt-1 font-medium tabular-nums">{formatNumber(value)}</dd>
		</div>
	);
}
