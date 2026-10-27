import { MAX_TAGS, cleanTag } from "@/lib/contact-fields";

// What an automation is made of: one trigger, then steps. Steps are a tree: a condition holds a yes and a no branch,
// each its own list, and a contact leaves the automation at the end of whichever list it's in. Shared by the editor and
// the server, so both say the same about what a step needs.

export const AUTOMATION_STATUSES = ["draft", "active", "paused"];
export const RUN_STATUSES = ["waiting", "completed", "canceled", "failed"];
export const MAX_AUTOMATION_NAME = 100;
export const MAX_STEPS = 50;
export const MAX_DEPTH = 5;
export const MAX_DELAY = { minutes: 59, hours: 23, days: 365, weeks: 52 };
export const DELAY_UNITS = Object.keys(MAX_DELAY);
const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 };
export const MAX_URL_LENGTH = 2000;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_ANNIVERSARY_OFFSET = 365;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// enabled: false shows in the editor, greyed out, until it's decided whether it's needed.
export const TRIGGER_GROUPS = [
	{
		title: "Subscriber activity",
		items: [
			{ type: "form", label: "Completes a form", enabled: false },
			{ type: "tag_added", label: "Joins tag(s)", enabled: true },
			{ type: "segment", label: "Joins a segment", enabled: false },
			{ type: "link_clicked", label: "Clicks a link", enabled: true },
			{ type: "field_updated", label: "Updates field", enabled: true },
		],
	},
	{
		title: "Dates & events",
		items: [
			{ type: "anniversary", label: "Event anniversary", enabled: true },
			{ type: "exact_date", label: "Exact date", enabled: true },
		],
	},
	{
		title: "E-commerce",
		items: [
			{ type: "abandoned_cart", label: "Abandoned cart", enabled: false },
			{ type: "abandoned_checkout", label: "Abandoned checkout", enabled: false },
			{ type: "buys_product", label: "Buys specific product", enabled: false },
			{ type: "buys_any", label: "Buys any product", enabled: false },
			{ type: "purchase_frequency", label: "Purchase frequency", enabled: false },
			{ type: "buys_category", label: "Buys from category", enabled: false },
		],
	},
];

export const STEP_GROUPS = [
	{
		title: "Rules",
		items: [
			{ type: "delay", label: "Delay", enabled: true },
			{ type: "condition", label: "Condition", enabled: true },
			{ type: "ab_test", label: "A/B test", enabled: false },
		],
	},
	{
		title: "Actions",
		items: [
			{ type: "email", label: "Send email", enabled: true },
			{ type: "webhook", label: "Webhook", enabled: true },
			{ type: "notify", label: "Send internal notification", enabled: true },
			{ type: "goto", label: "Move to step", enabled: false },
			{ type: "field_update", label: "Update custom field", enabled: true },
			{ type: "tags_copy", label: "Copy to tags", enabled: true },
			{ type: "tags_move", label: "Move to tags", enabled: true },
			{ type: "tags_remove", label: "Remove from tags", enabled: true },
			{ type: "unsubscribe", label: "Unsubscribe", enabled: true },
		],
	},
];

const TRIGGERS = new Map(TRIGGER_GROUPS.flatMap(({ items }) => items).map((item) => [item.type, item]));
const STEPS = new Map(STEP_GROUPS.flatMap(({ items }) => items).map((item) => [item.type, item]));
export const TRIGGER_TYPES = [...TRIGGERS.keys()];
export const STEP_TYPES = [...STEPS.keys()];

export function getTriggerInfo(type) {
	return TRIGGERS.get(type) ?? null;
}

export function getStepInfo(type) {
	return STEPS.get(type) ?? null;
}

export function isTriggerEnabled(type) {
	return Boolean(TRIGGERS.get(type)?.enabled);
}

export function isStepEnabled(type) {
	return Boolean(STEPS.get(type)?.enabled);
}

// Every step, depth first, with the list it's in and its depth.
export function* walkSteps(steps, depth = 1) {
	for (const step of steps ?? []) {
		yield { step, depth };
		if (step.type === "condition") {
			yield* walkSteps(step.yes, depth + 1);
			yield* walkSteps(step.no, depth + 1);
		}
	}
}

export function countSteps(steps) {
	let count = 0;
	for (const _ of walkSteps(steps)) count++;
	return count;
}

export function findStep(steps, id) {
	for (const { step } of walkSteps(steps)) if (step.id === id) return step;
	return null;
}

// The step a contact goes to after this one: the next in its list, or null at the list's end, where it leaves.
export function findNextStep(steps, id) {
	const list = findListOf(steps, id);
	if (!list) return null;
	return list[list.findIndex((step) => step.id === id) + 1] ?? null;
}

function findListOf(steps, id) {
	if (steps.some((step) => step.id === id)) return steps;
	for (const step of steps) {
		if (step.type !== "condition") continue;
		const found = findListOf(step.yes ?? [], id) ?? findListOf(step.no ?? [], id);
		if (found) return found;
	}
	return null;
}

// A list's key: "root", or a condition's ID and branch, "<id>:yes".
export function getList(steps, key) {
	if (key === "root") return steps;
	const [id, branch] = key.split(":");
	const condition = findStep(steps, id);
	return condition?.type === "condition" ? (condition[branch] ?? []) : null;
}

// A copy of the steps with one list changed by change(list) -> list.
export function updateList(steps, key, change) {
	if (key === "root") return change(steps);
	const [id, branch] = key.split(":");
	return steps.map((step) => {
		if (step.type !== "condition") return step;
		if (step.id === id) return { ...step, [branch]: change(step[branch] ?? []) };
		return { ...step, yes: updateList(step.yes ?? [], key, change), no: updateList(step.no ?? [], key, change) };
	});
}

export function updateStep(steps, id, change) {
	return steps.map((step) => {
		if (step.id === id) return change(step);
		if (step.type !== "condition") return step;
		return { ...step, yes: updateStep(step.yes ?? [], id, change), no: updateStep(step.no ?? [], id, change) };
	});
}

export function removeStep(steps, id) {
	return steps
		.filter((step) => step.id !== id)
		.map((step) => (step.type === "condition" ? { ...step, yes: removeStep(step.yes ?? [], id), no: removeStep(step.no ?? [], id) } : step));
}

export function newStepId() {
	return Math.random().toString(36).slice(2, 10);
}

export function newStep(type) {
	const base = { id: newStepId(), type, config: defaultConfig(type) };
	return type === "condition" ? { ...base, yes: [], no: [] } : base;
}

function defaultConfig(type) {
	if (type === "delay") return { amount: 1, unit: "days" };
	if (type === "condition") return { match: "all", conditions: [] };
	return {};
}

export function getDelayMs({ amount, unit } = {}) {
	return (Number(amount) || 0) * (UNIT_MS[unit] ?? 0);
}

function readTags(values) {
	return [...new Set((Array.isArray(values) ? values : []).map(cleanTag).filter(Boolean))].slice(0, MAX_TAGS);
}

function readHttpsUrl(value) {
	const text = String(value ?? "").trim().slice(0, MAX_URL_LENGTH);
	try {
		const url = new URL(text);
		// The standard port only: a webhook reaches a website, never another service on the host.
		return url.protocol === "https:" && !url.port && !url.username && !url.password ? url.href : "";
	} catch {
		return "";
	}
}

function readLink(value) {
	const text = String(value ?? "").trim().slice(0, MAX_URL_LENGTH);
	try {
		const url = new URL(text);
		return ["http:", "https:"].includes(url.protocol) ? text : "";
	} catch {
		return "";
	}
}

// A trigger's settings as saved: unknown keys dropped, values cleaned. Saved even when incomplete, which
// getTriggerProblem says.
export function cleanTriggerConfig(type, config = {}) {
	if (type === "tag_added") {
		return { tags: readTags(config.tags), exclude: readTags(config.exclude), exitOnLeave: Boolean(config.exitOnLeave) };
	}
	if (type === "link_clicked") return { url: readLink(config.url), match: config.match === "prefix" ? "prefix" : "exact" };
	if (type === "field_updated") return { field: String(config.field ?? "").slice(0, 60) };
	if (type === "anniversary") {
		const offset = Math.trunc(Number(config.offsetDays) || 0);
		return {
			field: String(config.field ?? "").slice(0, 60),
			offsetDays: Math.max(-MAX_ANNIVERSARY_OFFSET, Math.min(MAX_ANNIVERSARY_OFFSET, offset)),
			time: TIME_PATTERN.test(config.time ?? "") ? config.time : "09:00",
		};
	}
	if (type === "exact_date") {
		const at = config.at ? new Date(config.at) : null;
		return { at: at && Number.isFinite(at.getTime()) ? at.toISOString() : null, tags: readTags(config.tags) };
	}
	return {};
}

// emailId stays as the server gave it; the rest is cleaned like the trigger's.
export function cleanStepConfig(type, config = {}) {
	if (type === "delay") {
		const unit = DELAY_UNITS.includes(config.unit) ? config.unit : "days";
		const amount = Math.trunc(Number(config.amount) || 0);
		return { amount: Math.max(0, Math.min(MAX_DELAY[unit], amount)), unit };
	}
	if (type === "condition") {
		return {
			match: config.match === "any" ? "any" : "all",
			conditions: (Array.isArray(config.conditions) ? config.conditions : []).slice(0, 10).map(({ field, op, value }) => ({
				field: String(field ?? "").slice(0, 60),
				op: String(op ?? "").slice(0, 20),
				...(value !== undefined && value !== null && { value: typeof value === "number" ? value : String(value).slice(0, 200) }),
			})),
		};
	}
	if (type === "email") return { ...(typeof config.emailId === "string" && /^[a-f0-9]{24}$/.test(config.emailId) && { emailId: config.emailId }) };
	if (type === "webhook") return { url: readHttpsUrl(config.url) };
	if (type === "notify") return { note: String(config.note ?? "").trim().slice(0, MAX_NOTE_LENGTH) };
	if (type === "field_update") {
		const value = config.value;
		return {
			field: String(config.field ?? "").slice(0, 60),
			value: value === null || value === undefined ? null : typeof value === "number" ? value : String(value).slice(0, 500),
		};
	}
	if (["tags_copy", "tags_move", "tags_remove"].includes(type)) return { tags: readTags(config.tags) };
	return {};
}

// What the trigger still needs before the automation can start, or null. fields: the account's own fields.
export function getTriggerProblem(trigger, { fields = [] } = {}) {
	if (!trigger?.type) return "Pick a trigger";
	if (!isTriggerEnabled(trigger.type)) return "This trigger isn't available yet";
	const config = trigger.config ?? {};
	if (trigger.type === "tag_added" && !config.tags?.length) return "Pick at least one tag";
	if (trigger.type === "link_clicked" && !config.url) return "Enter the link";
	if (trigger.type === "field_updated" && !fields.some(({ key }) => key === config.field)) return "Pick a field";
	if (trigger.type === "anniversary" && !fields.some(({ key, type }) => key === config.field && type === "date")) return "Pick a date field";
	if (trigger.type === "exact_date" && !config.at) return "Pick the date and time";
	return null;
}

// What a step still needs, or null.
export function getStepProblem(step, { fields = [] } = {}) {
	if (!isStepEnabled(step.type)) return "This step isn't available yet";
	const config = step.config ?? {};
	if (step.type === "delay" && !(config.amount > 0)) return "Set how long to wait";
	if (step.type === "condition" && !config.conditions?.length) return "Add a condition";
	if (step.type === "email" && !config.emailId) return "Set up the email";
	if (step.type === "webhook" && !config.url) return "Enter an https link";
	if (step.type === "field_update" && !fields.some(({ key }) => key === config.field)) return "Pick a field";
	if (["tags_copy", "tags_move", "tags_remove"].includes(step.type) && !config.tags?.length) return "Pick at least one tag";
	return null;
}

// Every step that isn't ready, the trigger first: [{ id, problem }], the trigger's id "trigger".
export function listIncompleteSteps(automation, { fields = [], emails = new Map() } = {}) {
	const problems = [];
	const triggerProblem = getTriggerProblem(automation.trigger, { fields });
	if (triggerProblem) problems.push({ id: "trigger", problem: triggerProblem });
	if (!automation.steps?.length) problems.push({ id: "steps", problem: "Add a step after the trigger" });
	for (const { step } of walkSteps(automation.steps)) {
		let problem = getStepProblem(step, { fields });
		if (!problem && step.type === "email") {
			const email = emails.get(step.config.emailId);
			if (!email) problem = "Set up the email";
			else if (!email.subject?.trim()) problem = "Add the email's subject";
			else if (!email.html?.trim()) problem = "Write the email";
		}
		if (problem) problems.push({ id: step.id, problem });
	}
	return problems;
}

function list(values) {
	return values.map((value) => `"${value}"`).join(", ");
}

// The trigger in words, for the automations list: "When a contact joins the tag "vip"".
export function describeTrigger(trigger, fields = []) {
	const config = trigger?.config ?? {};
	const fieldLabel = (key) => fields.find((field) => field.key === key)?.label ?? key;
	switch (trigger?.type) {
		case "tag_added":
			return config.tags?.length ? `When a contact joins ${config.tags.length > 1 ? "tags" : "the tag"} ${list(config.tags)}` : "When a contact joins a tag";
		case "link_clicked":
			return config.url ? `When a contact clicks ${config.match === "prefix" ? "a link starting with" : "the link"} ${config.url}` : "When a contact clicks a link";
		case "field_updated":
			return config.field ? `When a contact's ${fieldLabel(config.field)} changes` : "When a field changes";
		case "anniversary":
			return config.field ? `On the anniversary of ${fieldLabel(config.field)}` : "On a date's anniversary";
		case "exact_date":
			return config.at ? `On ${new Date(config.at).toISOString().slice(0, 16).replace("T", " ")} UTC` : "On a date";
		default:
			return "No trigger yet";
	}
}

export function describeDelay({ amount, unit } = {}) {
	if (!(amount > 0)) return "Set up delay";
	const name = amount === 1 ? unit.replace(/s$/, "") : unit;
	return `Wait ${amount} ${name}`;
}
