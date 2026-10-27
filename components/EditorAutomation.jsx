"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	ArrowRightLeft,
	Bell,
	CalendarDays,
	Cake,
	ChartColumn,
	CircleAlert,
	ClipboardList,
	Clock,
	Copy,
	CornerDownRight,
	FlaskConical,
	LayoutGrid,
	Link as LinkIcon,
	Loader2,
	LogOut,
	Mail,
	Maximize,
	Minus,
	MoreVertical,
	Pause,
	Play,
	Plus,
	RefreshCw,
	Settings,
	ShoppingBag,
	ShoppingCart,
	Split,
	Tag,
	Trash2,
	UserCheck,
	UserX,
	Users,
	Wallet,
	Webhook,
	X,
	Zap,
} from "lucide-react";
import {
	addAutomationContacts,
	createAutomationEmail,
	saveAutomation,
	saveAutomationEmail,
	sendAutomationTest,
	setAutomationActive,
} from "@/app/(app)/automations/actions";
import BadgeSoon from "@/components/BadgeSoon";
import LogoBrand from "@/components/LogoBrand";
import PanelAutomationStep from "@/components/PanelAutomationStep";
import StatusSaved from "@/components/StatusSaved";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
	STEP_GROUPS,
	TRIGGER_GROUPS,
	cleanTriggerConfig,
	describeDelay,
	describeTrigger,
	findStep,
	getStepInfo,
	getTriggerInfo,
	listIncompleteSteps,
	newStep,
	removeStep,
	updateList,
	updateStep,
	walkSteps,
} from "@/lib/automation-steps";
import { formatNumber, formatRate } from "@/lib/format";
import { toast } from "@/lib/toast";
import { useAutosave } from "@/lib/use-autosave";
import { cn } from "@/lib/utils";

const ICONS = {
	form: ClipboardList,
	tag_added: Users,
	segment: Users,
	link_clicked: LinkIcon,
	field_updated: RefreshCw,
	anniversary: Cake,
	exact_date: CalendarDays,
	abandoned_cart: ShoppingCart,
	abandoned_checkout: Wallet,
	buys_product: Tag,
	buys_any: ShoppingBag,
	purchase_frequency: UserCheck,
	buys_category: LayoutGrid,
	delay: Clock,
	condition: Split,
	ab_test: FlaskConical,
	email: Mail,
	webhook: Webhook,
	notify: Bell,
	goto: CornerDownRight,
	field_update: RefreshCw,
	tags_copy: Copy,
	tags_move: ArrowRightLeft,
	tags_remove: X,
	unsubscribe: UserX,
};
// Triggers yellow, rules violet, actions blue, as MailerLite has them.
const TONES = {
	trigger: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
	rule: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
	action: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
};
const RULES = new Set(["delay", "condition", "ab_test"]);
const DRAG_TYPE = "application/x-mailer-step";
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25];

function toneOf(type, isTrigger) {
	return isTrigger ? TONES.trigger : RULES.has(type) ? TONES.rule : TONES.action;
}

// The automation's editor, full screen: the steps on a canvas, what to add on the left, a step's settings on the right.
// Every change is saved as it's made; a step's settings on Save.
export default function EditorAutomation({ automation, newsletter, fields, tags, segments, isSendingEnabled }) {
	const router = useRouter();
	const id = automation.id;
	const [values, setValues] = useState(() => ({
		name: automation.name,
		trigger: automation.trigger?.type ? automation.trigger : null,
		steps: automation.steps ?? [],
		reenter: automation.reenter,
	}));
	const [status, setStatus] = useState(automation.status);
	const [emails, setEmails] = useState(() => new Map(automation.emails.map((email) => [email.id, email])));
	const [waitingByStep, setWaitingByStep] = useState(automation.waitingByStep ?? {});
	const [panel, setPanel] = useState(() => (automation.trigger?.type ? "activity" : "add"));
	const [addTab, setAddTab] = useState(() => (automation.trigger?.type ? "steps" : "triggers"));
	const [insertAt, setInsertAt] = useState(null);
	const [selected, setSelected] = useState(null);
	const [zoom, setZoom] = useState(1);
	const [isAdding, setIsAdding] = useState(false);
	const [isWorking, startWorking] = useTransition();

	const save = useCallback(
		async (snapshot) => {
			const result = await saveAutomation(id, { ...snapshot, trigger: snapshot.trigger ?? undefined });
			if (result?.ok) setWaitingByStep(result.waitingByStep ?? {});
			return result;
		},
		[id]
	);
	const { isSaving, savedAt, error, flush } = useAutosave(values, save);
	const incomplete = useMemo(
		() => listIncompleteSteps({ trigger: values.trigger, steps: values.steps }, { fields, emails: new Map([...emails].map(([key, email]) => [key, { ...email, html: email.hasContent ? "x" : "" }])) }),
		[values.trigger, values.steps, fields, emails]
	);
	const problems = new Map(incomplete.map(({ id: stepId, problem }) => [stepId, problem]));

	function change(next) {
		setValues((current) => ({ ...current, ...(typeof next === "function" ? next(current) : next) }));
	}

	async function persist() {
		if (await flush()) return true;
		toast.error("Couldn't save the automation");
		return false;
	}

	function pickTrigger(type) {
		if (!getTriggerInfo(type)?.enabled) return;
		change({ trigger: { type, config: cleanTriggerConfig(type, {}) } });
		setSelected("trigger");
		setAddTab("steps");
	}

	async function addStep(type, target = insertAt ?? { list: "root", index: values.steps.length }) {
		if (!getStepInfo(type)?.enabled || isAdding) return;
		const step = newStep(type);
		if (type === "email") {
			setIsAdding(true);
			const result = await createAutomationEmail(id);
			setIsAdding(false);
			if (result?.error) return void toast.error(result.error);
			step.config = { emailId: result.email.id };
			setEmails((current) => new Map(current).set(result.email.id, { ...result.email, stats: {}, hasContent: false }));
		}
		change(({ steps }) => ({ steps: updateList(steps, target.list, (list) => [...list.slice(0, target.index), step, ...list.slice(target.index)]) }));
		setInsertAt(null);
		setSelected(step.id);
	}

	function deleteStep(stepId) {
		if (waitingByStep[stepId] > 0) return void toast.error("Contacts are waiting at this step: it stays while they do");
		const step = findStep(values.steps, stepId);
		const inside = step?.type === "condition" ? [...walkSteps([step])].some(({ step: item }) => waitingByStep[item.id] > 0) : false;
		if (inside) return void toast.error("Contacts are waiting in this condition's branches");
		change(({ steps }) => ({ steps: removeStep(steps, stepId) }));
		if (selected === stepId) setSelected(null);
	}

	function saveSelected(config, emailDraft) {
		if (selected === "trigger") {
			change(({ trigger }) => ({ trigger: { ...trigger, config: cleanTriggerConfig(trigger.type, config) } }));
		} else {
			change(({ steps }) => ({ steps: updateStep(steps, selected, (step) => ({ ...step, config })) }));
		}
		if (emailDraft && config.emailId) void saveEmail(config.emailId, emailDraft);
		setSelected(null);
	}

	async function saveEmail(emailId, draft) {
		const result = await saveAutomationEmail(id, emailId, draft);
		if (result?.error) return void toast.error(result.error);
		setEmails((current) => new Map(current).set(emailId, { ...current.get(emailId), ...draft }));
	}

	async function designEmail(emailId, draft) {
		if (!(await persist())) return;
		await saveEmail(emailId, draft);
		router.push(`/automations/${id}/emails/${emailId}`);
	}

	function toggleActive() {
		startWorking(async () => {
			if (!(await persist())) return;
			const result = await setAutomationActive(id, status !== "active");
			if (result?.error) return void toast.error(result.error);
			setStatus(result.status);
			toast.success(result.status === "active" ? "The automation is on" : "The automation is paused");
		});
	}

	function sendTest() {
		startWorking(async () => {
			if (!(await persist())) return;
			const result = await sendAutomationTest(id);
			if (result?.error) return void toast.error(result.error);
			toast.success(`${result.sent} test email${result.sent === 1 ? "" : "s"} sent to ${result.to}`);
		});
	}

	function openAdd(target) {
		setInsertAt(target);
		setAddTab("steps");
		setPanel("add");
	}

	function drop(event, target) {
		event.preventDefault();
		const [kind, type] = (event.dataTransfer.getData(DRAG_TYPE) || ":").split(":");
		if (kind === "trigger") pickTrigger(type);
		if (kind === "step" && target) void addStep(type, target);
	}

	const selectedStep = selected === "trigger" ? values.trigger : selected ? findStep(values.steps, selected) : null;
	const labels = useMemo(() => numberSteps(values.steps), [values.steps]);

	return (
		<div className="fixed inset-0 z-40 flex flex-col bg-background">
			<header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-3 sm:px-4">
				<LogoBrand className="h-7 shrink-0" />
				<input
					value={values.name}
					onChange={(event) => change({ name: event.target.value })}
					onBlur={() => !values.name.trim() && change({ name: automation.name })}
					aria-label="Automation name"
					maxLength={100}
					className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-base font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				/>
				<span className="hidden sm:block">{error ? <span className="text-xs text-destructive">{error}</span> : isSaving ? <span className="text-xs text-muted-foreground">Saving…</span> : <StatusSaved savedAt={savedAt} />}</span>
				<Button variant="outline" size="sm" onClick={sendTest} disabled={isWorking || !isSendingEnabled}>
					Test
				</Button>
				<Button size="sm" onClick={toggleActive} disabled={isWorking || (status !== "active" && incomplete.length > 0)}>
					{isWorking ? <Loader2 data-icon="inline-start" className="animate-spin" /> : status === "active" ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
					{status === "active" ? "Pause" : "Activate"}
				</Button>
				<Button variant="ghost" size="icon-sm" aria-label="Close the editor" asChild>
					<Link
						href="/automations"
						onClick={async (event) => {
							event.preventDefault();
							if (await persist()) router.push("/automations");
						}}
					>
						<X />
					</Link>
				</Button>
			</header>

			<div className="flex min-h-0 flex-1">
				<nav aria-label="Editor panels" className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border/60 py-3">
					<RailButton label="Activity hub" icon={ChartColumn} isActive={panel === "activity"} hasAlert={incomplete.length > 0} onClick={() => setPanel(panel === "activity" ? null : "activity")} />
					<RailButton label="Add step" icon={Plus} isActive={panel === "add"} onClick={() => setPanel(panel === "add" ? null : "add")} />
					<RailButton label="Settings" icon={Settings} isActive={panel === "settings"} onClick={() => setPanel(panel === "settings" ? null : "settings")} />
				</nav>

				{panel && (
					<aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-border/60 max-md:absolute max-md:inset-y-14 max-md:left-14 max-md:z-10 max-md:bg-background">
						{panel === "activity" && (
							<PanelActivity
								automation={automation}
								status={status}
								emails={[...emails.values()]}
								incomplete={incomplete}
								labels={labels}
								segments={segments}
								tags={tags}
								onSelect={setSelected}
								onClose={() => setPanel(null)}
							/>
						)}
						{panel === "add" && (
							<PanelAdd
								tab={addTab}
								onTab={setAddTab}
								hasTrigger={Boolean(values.trigger)}
								isAdding={isAdding}
								onTrigger={pickTrigger}
								onStep={(type) => void addStep(type)}
								onClose={() => setPanel(null)}
							/>
						)}
						{panel === "settings" && <PanelSettings key={String(values.reenter)} reenter={values.reenter} onSave={(reenter) => change({ reenter })} onClose={() => setPanel(null)} />}
					</aside>
				)}

				<main className="relative min-w-0 flex-1 bg-muted/40" onDragOver={(event) => event.preventDefault()}>
					<div className="absolute inset-0 overflow-auto">
						<div className="flex min-h-full justify-center px-6 py-8" style={{ zoom }}>
							<div className="flex flex-col items-center">
								{values.trigger ? (
									<CardStep
										type={values.trigger.type}
										isTrigger
										title={getTriggerInfo(values.trigger.type)?.label ?? "Trigger"}
										summary={describeTrigger(values.trigger, fields)}
										problem={problems.get("trigger")}
										isSelected={selected === "trigger"}
										onSelect={() => setSelected("trigger")}
										onChangeTrigger={() => {
											setAddTab("triggers");
											setPanel("add");
										}}
									/>
								) : (
									<div
										onDragOver={(event) => event.preventDefault()}
										onDrop={(event) => drop(event)}
										className="flex w-80 flex-col items-center gap-3 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 px-6 py-10 text-center dark:border-amber-500/40 dark:bg-amber-500/5"
									>
										<Zap className="size-6 text-amber-600" />
										<p className="font-medium">Drop a step here to get started!</p>
										<p className="text-sm text-muted-foreground">To start building your automation, pick a trigger from the Add step panel.</p>
									</div>
								)}
								{values.trigger && (
									<>
										<ListSteps
											listKey="root"
											steps={values.steps}
											labels={labels}
											problems={problems}
											waitingByStep={waitingByStep}
											emails={emails}
											fields={fields}
											selected={selected}
											onSelect={setSelected}
											onDelete={deleteStep}
											onAdd={openAdd}
											onDrop={drop}
										/>
										<ExitFlow />
									</>
								)}
							</div>
						</div>
					</div>
					{/* On the canvas's own corner, so a step's settings never cover it. */}
					<div className="absolute right-4 bottom-4 z-10 flex flex-col overflow-hidden rounded-lg bg-background shadow-border">
						<Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => setZoom(nextZoom(zoom, 1))}>
							<Plus />
						</Button>
						<Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => setZoom(nextZoom(zoom, -1))}>
							<Minus />
						</Button>
						<Button variant="ghost" size="icon-sm" aria-label="Actual size" onClick={() => setZoom(1)}>
							<Maximize />
						</Button>
					</div>
				</main>

				{selectedStep && (
					<div className="max-sm:absolute max-sm:inset-x-0 max-sm:top-14 max-sm:bottom-0 max-sm:z-20 flex">
						<PanelAutomationStep
							key={selected}
							automationId={id}
							step={selectedStep}
							isTrigger={selected === "trigger"}
							label={selected === "trigger" ? (getTriggerInfo(selectedStep.type)?.label ?? "Trigger") : labels.get(selected)}
							email={selectedStep.type === "email" ? emails.get(selectedStep.config?.emailId) : null}
							newsletter={newsletter}
							fields={fields}
							tags={tags}
							waiting={waitingByStep[selected]}
							webhookSecret={automation.webhookSecret}
							notifyRecipients={automation.notifyRecipients}
							onSave={saveSelected}
							onClose={() => setSelected(null)}
							onDesignEmail={(draft) => designEmail(selectedStep.config.emailId, draft)}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

// "Delay 1", "Email 2": each step numbered among the steps of its kind, top to bottom.
function numberSteps(steps) {
	const counts = {};
	const labels = new Map();
	for (const { step } of walkSteps(steps)) {
		counts[step.type] = (counts[step.type] ?? 0) + 1;
		labels.set(step.id, `${SHORT_LABELS[step.type] ?? getStepInfo(step.type)?.label ?? step.type} ${counts[step.type]}`);
	}
	return labels;
}

const SHORT_LABELS = {
	delay: "Time delay",
	condition: "Condition",
	email: "Email",
	webhook: "Webhook",
	notify: "Notification",
	field_update: "Update field",
	tags_copy: "Copy to tags",
	tags_move: "Move to tags",
	tags_remove: "Remove from tags",
	unsubscribe: "Unsubscribe",
};

function nextZoom(zoom, direction) {
	const index = ZOOMS.indexOf(zoom);
	return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (index === -1 ? 3 : index) + direction))];
}

function RailButton({ label, icon: Icon, isActive, hasAlert, onClick }) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={isActive}
			onClick={onClick}
			className={cn(
				"relative grid size-9 place-items-center rounded-lg transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
				isActive ? "bg-primary/10 text-foreground shadow-border" : "text-muted-foreground hover:bg-muted hover:text-foreground"
			)}
		>
			<Icon className="size-4" />
			{hasAlert && <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-semibold text-white">!</span>}
		</button>
	);
}

function PanelHeader({ title, onClose }) {
	return (
		<header className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
			<h2 className="text-lg font-semibold">{title}</h2>
			<Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
				<X />
			</Button>
		</header>
	);
}

function PanelAdd({ tab, onTab, hasTrigger, isAdding, onTrigger, onStep, onClose }) {
	const groups = tab === "triggers" ? TRIGGER_GROUPS : STEP_GROUPS;
	return (
		<>
			<PanelHeader title="Add step" onClose={onClose} />
			<div role="tablist" className="mx-5 flex gap-5 border-b border-border/60">
				{[
					{ id: "triggers", label: "Triggers" },
					{ id: "steps", label: "Rules & actions" },
				].map(({ id, label }) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={tab === id}
						onClick={() => onTab(id)}
						className={cn(
							"-mb-px border-b-2 pb-2 text-sm font-medium transition-colors duration-150",
							tab === id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
						)}
					>
						{label}
					</button>
				))}
			</div>
			{tab === "steps" && !hasTrigger && <p className="mx-5 mt-3 text-sm text-muted-foreground">Pick a trigger first.</p>}
			<div className="flex flex-col gap-5 p-5">
				{groups.map((group) => (
					<section key={group.title} className="flex flex-col gap-2">
						<h3 className="text-sm font-semibold">{group.title}</h3>
						{group.items.map((item) => {
							const isTrigger = tab === "triggers";
							const isEnabled = item.enabled && (isTrigger || hasTrigger) && !isAdding;
							const Icon = ICONS[item.type] ?? Zap;
							return (
								<button
									key={item.type}
									type="button"
									draggable={isEnabled}
									disabled={!isEnabled}
									onDragStart={(event) => event.dataTransfer.setData(DRAG_TYPE, `${isTrigger ? "trigger" : "step"}:${item.type}`)}
									onClick={() => (isTrigger ? onTrigger(item.type) : onStep(item.type))}
									className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm shadow-border transition-colors duration-150 hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-55"
								>
									<span className={cn("grid size-7 shrink-0 place-items-center rounded-md", toneOf(item.type, isTrigger))}>
										<Icon className="size-4" />
									</span>
									<span className="min-w-0 flex-1 truncate">{item.label}</span>
									{!item.enabled && <BadgeSoon />}
								</button>
							);
						})}
					</section>
				))}
			</div>
		</>
	);
}

function PanelSettings({ reenter, onSave, onClose }) {
	const [value, setValue] = useState(reenter);
	return (
		<div className="flex min-h-full flex-col">
			<PanelHeader title="Settings" onClose={onClose} />
			<div className="flex flex-1 flex-col gap-6 px-5">
				<section className="flex flex-col gap-2">
					<h3 className="font-semibold">Re-enter automation</h3>
					<p className="text-sm text-muted-foreground">Subscribers who have exited this automation and match the trigger again will re-enter it.</p>
					<label className="flex items-start gap-2.5 text-sm">
						<input type="checkbox" checked={value} onChange={(event) => setValue(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-foreground" />
						Allow subscribers re-enter automation
					</label>
				</section>
				<section className="flex flex-col gap-2 text-muted-foreground">
					<h3 className="flex items-center gap-2 font-semibold text-foreground">
						E-commerce tracking <BadgeSoon />
					</h3>
					<p className="text-sm">Monitor your sales generated from the email or email series in this automation.</p>
					<label className="flex items-start gap-2.5 text-sm">
						<input type="checkbox" disabled className="mt-0.5 size-4 shrink-0 accent-foreground" />
						Activate e-commerce tracking for this automation
					</label>
				</section>
			</div>
			<footer className="flex justify-end border-t border-border/60 p-4">
				<Button onClick={() => onSave(value)} disabled={value === reenter}>
					Save
				</Button>
			</footer>
		</div>
	);
}

function PanelActivity({ automation, status, emails, incomplete, labels, segments, tags, onSelect, onClose }) {
	const [isShowingProblems, setIsShowingProblems] = useState(false);
	const [isAddOpen, setIsAddOpen] = useState(false);
	const { counts } = automation;
	const totals = emails.reduce(
		(sum, { stats = {} }) => ({
			sent: sum.sent + (stats.sent ?? 0),
			opened: sum.opened + (stats.opened ?? 0),
			clicked: sum.clicked + (stats.clicked ?? 0),
			unsubscribed: sum.unsubscribed + (stats.unsubscribed ?? 0),
			bounced: sum.bounced + (stats.bounced ?? 0),
		}),
		{ sent: 0, opened: 0, clicked: 0, unsubscribed: 0, bounced: 0 }
	);

	return (
		<>
			{incomplete.length > 0 && (
				<div className="border-b border-destructive/20 bg-destructive/5 px-5 py-3 text-sm">
					<div className="flex items-center gap-2">
						<CircleAlert className="size-4 text-destructive" />
						<span className="flex-1">
							{incomplete.length} incomplete step{incomplete.length > 1 ? "s" : ""}
						</span>
						<button type="button" className="font-medium text-destructive" onClick={() => setIsShowingProblems(!isShowingProblems)}>
							{isShowingProblems ? "Hide" : "See details"}
						</button>
					</div>
					{isShowingProblems && (
						<ul className="mt-2 flex flex-col gap-1">
							{incomplete.map(({ id, problem }) => (
								<li key={id}>
									<button
										type="button"
										disabled={id === "steps"}
										onClick={() => onSelect(id)}
										className="text-left text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground"
									>
										<span className="font-medium text-foreground">{id === "trigger" ? "Trigger" : id === "steps" ? "Steps" : labels.get(id)}:</span> {problem}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
			<PanelHeader title="Activity hub" onClose={onClose} />
			<div className="flex flex-col gap-5 border-b border-border/60 px-5 pb-5">
				<Stat label="Started" value={formatNumber(counts.started)} />
				<div className="grid grid-cols-2 gap-5">
					<Stat label="In progress" value={formatNumber(counts.waiting)} />
					<Stat label="Completed" value={formatNumber(counts.completed)} />
					<Stat label="Canceled" value={formatNumber(counts.canceled)} />
					<Stat label="Failed" value={formatNumber(counts.failed)} />
				</div>
				<Button variant="secondary" asChild>
					<Link href={`/automations/${automation.id}/activity`}>View workflow activity</Link>
				</Button>
				<Button variant="outline" disabled={status !== "active"} onClick={() => setIsAddOpen(true)} title={status !== "active" ? "Activate the automation first" : undefined}>
					Add subscribers
				</Button>
			</div>
			<div className="flex flex-col gap-5 p-5">
				<Stat label="Total emails sent" value={formatNumber(totals.sent)} />
				<div className="grid grid-cols-2 gap-5">
					<Stat label="Avg. open rate" value={formatRate(totals.opened, totals.sent) ?? "–"} />
					<Stat label="Avg. click rate" value={formatRate(totals.clicked, totals.sent) ?? "–"} />
					<Stat label="Avg. unsubscribe rate" value={formatRate(totals.unsubscribed, totals.sent) ?? "–"} />
					<Stat label="Avg. bounce rate" value={formatRate(totals.bounced, totals.sent) ?? "–"} />
				</div>
				<Button variant="secondary" asChild>
					<Link href={`/automations/${automation.id}/activity#report`}>View full report</Link>
				</Button>
			</div>
			<DialogAddContacts automationId={automation.id} isOpen={isAddOpen} onOpenChange={setIsAddOpen} segments={segments} tags={tags} />
		</>
	);
}

function Stat({ label, value }) {
	return (
		<div>
			<p className="text-sm text-muted-foreground">{label}</p>
			<p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
		</div>
	);
}

// Add subscribers: a tag's or a segment's active contacts, counted before they go in.
function DialogAddContacts({ automationId, isOpen, onOpenChange, segments, tags }) {
	const router = useRouter();
	const [choice, setChoice] = useState("");
	const [count, setCount] = useState(null);
	const [isPending, startTransition] = useTransition();
	const target = choice.startsWith("tag:") ? { tag: choice.slice(4) } : choice.startsWith("segment:") ? { segment: choice.slice(8) } : null;

	function pick(value) {
		setChoice(value);
		setCount(null);
		const next = value.startsWith("tag:") ? { tag: value.slice(4) } : { segment: value.slice(8) };
		startTransition(async () => {
			const result = await addAutomationContacts(automationId, { ...next, countOnly: true });
			if (result?.error) return void toast.error(result.error);
			setCount(result.contacts);
		});
	}

	function add() {
		startTransition(async () => {
			const result = await addAutomationContacts(automationId, target);
			if (result?.error) return void toast.error(result.error);
			toast.success(`${formatNumber(result.added)} contact${result.added === 1 ? "" : "s"} added`);
			onOpenChange(false);
			router.refresh();
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add subscribers</DialogTitle>
					<DialogDescription>Their active contacts go in now, as if the trigger fired. Contacts already in it, or who went through it, are skipped unless it lets them in again.</DialogDescription>
				</DialogHeader>
				<Select value={choice || undefined} onValueChange={pick}>
					<SelectTrigger aria-label="Who">
						<SelectValue placeholder="Pick a tag or a segment" />
					</SelectTrigger>
					<SelectContent>
						{tags.map((tag) => (
							<SelectItem key={`tag:${tag}`} value={`tag:${tag}`}>
								Tag: {tag}
							</SelectItem>
						))}
						{segments.map((segment) => (
							<SelectItem key={`segment:${segment.id}`} value={`segment:${segment.id}`}>
								Segment: {segment.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{count !== null && <p className="text-sm text-muted-foreground">{formatNumber(count)} active contacts.</p>}
				<DialogFooter>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={add} disabled={!target || !count || isPending}>
						{isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
						Add {count ? formatNumber(count) : ""}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ListSteps({ listKey, steps, labels, problems, waitingByStep, emails, fields, selected, onSelect, onDelete, onAdd, onDrop }) {
	return (
		<>
			<Connector target={{ list: listKey, index: 0 }} onAdd={onAdd} onDrop={onDrop} />
			{steps.map((step, index) => (
				<div key={step.id} className="flex flex-col items-center">
					<CardStep
						type={step.type}
						title={labels.get(step.id)}
						summary={summarize(step, { emails, fields })}
						problem={problems.get(step.id)}
						waiting={waitingByStep[step.id]}
						isSelected={selected === step.id}
						onSelect={() => onSelect(step.id)}
						onDelete={() => onDelete(step.id)}
					/>
					{step.type === "condition" ? (
						<div className="mt-0 flex items-start gap-8 pt-0">
							{["yes", "no"].map((branch) => (
								<div key={branch} className="flex flex-col items-center">
									<span className="mt-3 rounded-full bg-background px-2.5 py-0.5 text-xs font-medium shadow-border">{branch === "yes" ? "Yes" : "No"}</span>
									<ListSteps
										listKey={`${step.id}:${branch}`}
										steps={step[branch] ?? []}
										labels={labels}
										problems={problems}
										waitingByStep={waitingByStep}
										emails={emails}
										fields={fields}
										selected={selected}
										onSelect={onSelect}
										onDelete={onDelete}
										onAdd={onAdd}
										onDrop={onDrop}
									/>
									<ExitFlow />
								</div>
							))}
						</div>
					) : (
						index < steps.length && <Connector target={{ list: listKey, index: index + 1 }} onAdd={onAdd} onDrop={onDrop} />
					)}
				</div>
			))}
		</>
	);
}

// The line between two steps, with its + to add one there, which also takes a step dragged from the panel.
function Connector({ target, onAdd, onDrop }) {
	const [isOver, setIsOver] = useState(false);
	return (
		<div className="flex flex-col items-center">
			<span className="h-4 w-px bg-border" />
			<button
				type="button"
				aria-label="Add a step here"
				onClick={() => onAdd(target)}
				onDragOver={(event) => {
					event.preventDefault();
					setIsOver(true);
				}}
				onDragLeave={() => setIsOver(false)}
				onDrop={(event) => {
					setIsOver(false);
					onDrop(event, target);
				}}
				className={cn(
					"grid size-6 place-items-center rounded-md bg-background text-muted-foreground shadow-border transition-[background-color,scale] duration-150 hover:text-foreground",
					isOver && "scale-125 bg-primary text-primary-foreground"
				)}
			>
				<Plus className="size-3.5" />
			</button>
			<span className="h-4 w-px bg-border" />
		</div>
	);
}

function ExitFlow() {
	return (
		<div className="flex items-center gap-1.5 rounded-lg bg-background px-3 py-2 text-sm font-medium shadow-border">
			<LogOut className="size-4" />
			Exit flow
		</div>
	);
}

function CardStep({ type, isTrigger = false, title, summary, problem, waiting, isSelected, onSelect, onDelete, onChangeTrigger }) {
	const Icon = ICONS[type] ?? Zap;
	return (
		<div
			className={cn(
				"relative w-64 rounded-xl bg-background text-left shadow-border transition-shadow duration-150",
				isSelected && "ring-2 ring-emerald-500",
				problem && !isSelected && "ring-2 ring-destructive/40"
			)}
		>
			<div className="flex items-center gap-2 border-b border-border/60 py-2 pr-1.5 pl-3">
				<span className={cn("grid size-7 shrink-0 place-items-center rounded-md", toneOf(type, isTrigger))}>
					<Icon className="size-4" />
				</span>
				<button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left text-sm font-medium after:absolute after:inset-0">
					{title}
				</button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${title}`} className="relative z-10">
							<MoreVertical />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-40">
						<DropdownMenuItem onSelect={onSelect}>
							<Settings />
							Set up
						</DropdownMenuItem>
						{isTrigger ? (
							<DropdownMenuItem onSelect={onChangeTrigger}>
								<RefreshCw />
								Change trigger
							</DropdownMenuItem>
						) : (
							<DropdownMenuItem variant="destructive" onSelect={onDelete}>
								<Trash2 />
								Delete
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<p className={cn("px-3 py-3 text-sm", problem ? "text-muted-foreground" : "text-foreground")}>{summary}</p>
			{waiting > 0 && (
				<span className="absolute top-2 -right-12 flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs tabular-nums shadow-border" title="Contacts waiting here">
					<Users className="size-3" />
					{formatNumber(waiting)}
				</span>
			)}
		</div>
	);
}

function summarize(step, { emails, fields }) {
	const config = step.config ?? {};
	const fieldLabel = (key) => fields.find((field) => field.key === key)?.label ?? key;
	switch (step.type) {
		case "delay":
			return describeDelay(config);
		case "condition":
			return config.conditions?.length ? `${config.conditions.length} condition${config.conditions.length > 1 ? "s" : ""}` : "Set up condition";
		case "email": {
			const email = emails.get(config.emailId);
			return email?.subject || "Set up email";
		}
		case "tags_copy":
		case "tags_move":
		case "tags_remove":
			return config.tags?.length ? config.tags.join(", ") : "Select tag(s)";
		case "field_update":
			return config.field ? `${fieldLabel(config.field)}: ${config.value ?? "cleared"}` : "Select field";
		case "webhook":
			return config.url || "Set up webhook";
		case "notify":
			return config.note || "Notify the account";
		case "unsubscribe":
			return "Unsubscribe the contact";
		default:
			return "Not available yet";
	}
}
