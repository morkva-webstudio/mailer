import Link from "next/link";
import { notFound } from "next/navigation";
import AvatarContact from "@/components/AvatarContact";
import BadgeStatus from "@/components/BadgeStatus";
import HeaderPage from "@/components/HeaderPage";
import TextEmpty from "@/components/TextEmpty";
import TimeLocal from "@/components/TimeLocal";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { runDashboardAction } from "@/lib/actions/dashboard";
import { RUN_STATUSES, findStep, getStepInfo, walkSteps } from "@/lib/automation-steps";
import { formatNumber, formatRate } from "@/lib/format";
import { gravatarHash } from "@/lib/gravatar";
import { cn } from "@/lib/utils";

export const metadata = { title: "Automation activity" };

const STATUS_LABELS = { waiting: "In progress", completed: "Completed", canceled: "Canceled", failed: "Failed" };
const TONES = { waiting: "sending", completed: "sent", canceled: "paused", failed: "failed" };
const TIME = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

// Every contact's pass through the automation, and how each of its emails did.
export default async function AutomationActivityPage({ params, searchParams }) {
	const [{ id }, { status: rawStatus, before }] = await Promise.all([params, searchParams]);
	const status = RUN_STATUSES.includes(rawStatus) ? rawStatus : undefined;
	const [{ output: automation, failure }, activity] = await Promise.all([
		runDashboardAction("get_automation", { id }),
		runDashboardAction("list_automation_activity", { id, ...(status && { status }), ...(before && { before: String(before) }) }),
	]);
	if (failure || activity.failure) notFound();
	const { runs, nextCursor } = activity.output;
	const emailSteps = [...walkSteps(automation.steps)].filter(({ step }) => step.type === "email").map(({ step }) => step.config?.emailId);
	const emails = automation.emails.filter(({ id: emailId }) => emailSteps.includes(emailId));
	const stepName = (stepId) => {
		const step = findStep(automation.steps, stepId);
		return step ? getStepInfo(step.type)?.label : null;
	};
	const filterHref = (value) => `/automations/${id}/activity${value ? `?status=${value}` : ""}`;

	return (
		<>
			<HeaderPage title={automation.name} backHref={`/automations/${id}`} meta={<BadgeStatus status={automation.status} />} />

			<nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2 animate-enter">
				{[undefined, ...RUN_STATUSES].map((value) => (
					<Link
						key={value ?? "all"}
						href={filterHref(value)}
						aria-current={status === value ? "page" : undefined}
						className={cn(
							"flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm shadow-border transition-colors duration-150",
							status === value ? "bg-foreground text-background" : "hover:bg-muted"
						)}
					>
						{value ? STATUS_LABELS[value] : "All"}
						<span className="tabular-nums opacity-70">{formatNumber(value ? automation.counts[value] : automation.counts.started)}</span>
					</Link>
				))}
			</nav>

			<div className="overflow-hidden rounded-xl shadow-border animate-enter">
				<Table>
					<TableHeader>
						<TableRow className="hover:bg-transparent">
							<TableHead className="pl-4">Contact</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="hidden md:table-cell">Step</TableHead>
							<TableHead className="hidden sm:table-cell">Started</TableHead>
							<TableHead className="hidden pr-4 lg:table-cell">Last step</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{runs.length === 0 && (
							<TableRow className="hover:bg-transparent">
								<TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
									Nobody here yet
								</TableCell>
							</TableRow>
						)}
						{runs.map((run) => {
							const last = run.history.at(-1);
							return (
								<TableRow key={run.id} className="relative">
									<TableCell className="max-w-0 py-3 pl-4 sm:w-2/5">
										<Link href={`/contacts/${run.contactId}`} className="flex min-w-0 items-center gap-2.5 after:absolute after:inset-0">
											<AvatarContact email={run.email} gravatarHash={gravatarHash(run.email)} />
											<span className="truncate font-medium">{run.email}</span>
										</Link>
									</TableCell>
									<TableCell>
										<BadgeStatus status={TONES[run.status]} label={STATUS_LABELS[run.status]} />
										{run.reason && <p className="mt-1 max-w-56 truncate text-xs text-muted-foreground">{run.reason}</p>}
									</TableCell>
									<TableCell className="hidden md:table-cell">
										{stepName(run.stepId) ?? <TextEmpty />}
										{run.nextAt && (
											<p className="text-xs text-muted-foreground">
												until <TimeLocal value={run.nextAt} options={TIME} />
											</p>
										)}
									</TableCell>
									<TableCell className="hidden text-muted-foreground sm:table-cell">
										<TimeLocal value={run.startedAt} options={TIME} />
									</TableCell>
									<TableCell className="hidden pr-4 text-muted-foreground lg:table-cell">
										{last ? `${getStepInfo(last.type)?.label ?? last.type}: ${last.result}` : <TextEmpty />}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
			{nextCursor && (
				<div className="mt-4 flex justify-center">
					<Button variant="outline" asChild>
						<Link href={`/automations/${id}/activity?${new URLSearchParams({ ...(status && { status }), before: nextCursor })}`}>Older</Link>
					</Button>
				</div>
			)}

			<section id="report" className="mt-10 animate-enter">
				<h2 className="mb-4 text-lg font-semibold">Emails</h2>
				<div className="overflow-hidden rounded-xl shadow-border">
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="pl-4">Email</TableHead>
								<TableHead className="text-right">Sent</TableHead>
								<TableHead className="text-right">Opens</TableHead>
								<TableHead className="text-right">Clicks</TableHead>
								<TableHead className="hidden text-right sm:table-cell">Unsubscribes</TableHead>
								<TableHead className="hidden pr-4 text-right sm:table-cell">Bounces</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{emails.length === 0 && (
								<TableRow className="hover:bg-transparent">
									<TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
										No emails in this automation
									</TableCell>
								</TableRow>
							)}
							{emails.map(({ id: emailId, name, subject, stats }) => (
								<TableRow key={emailId}>
									<TableCell className="max-w-0 py-3 pl-4 sm:w-2/5">
										<p className="truncate font-medium">{name}</p>
										<p className="truncate text-xs text-muted-foreground">{subject || "No subject"}</p>
									</TableCell>
									<TableCell className="text-right tabular-nums">{formatNumber(stats.sent)}</TableCell>
									<TableCell className="text-right tabular-nums">{formatRate(stats.opened, stats.sent) ?? <TextEmpty />}</TableCell>
									<TableCell className="text-right tabular-nums">{formatRate(stats.clicked, stats.sent) ?? <TextEmpty />}</TableCell>
									<TableCell className="hidden text-right tabular-nums sm:table-cell">{formatRate(stats.unsubscribed, stats.sent) ?? <TextEmpty />}</TableCell>
									<TableCell className="hidden pr-4 text-right tabular-nums sm:table-cell">{formatRate(stats.bounced, stats.sent) ?? <TextEmpty />}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</section>
		</>
	);
}
