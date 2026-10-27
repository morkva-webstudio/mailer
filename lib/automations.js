import "server-only";
import crypto from "node:crypto";
import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import mongoose from "mongoose";
import { findOwnerEmail } from "@/lib/accounts";
import { isBlocked } from "@/lib/account-state";
import { findStep, findNextStep, getDelayMs, walkSteps } from "@/lib/automation-steps";
import { enrollContacts } from "@/lib/automation-triggers";
import { getAdminEmails, getAppUrl, isCloud, isSendingEnabled } from "@/lib/config";
import { readFieldValue } from "@/lib/contact-fields";
import { changeContactStatus, changeContactTags, updateContactDetails } from "@/lib/contacts";
import { connectDb } from "@/lib/db";
import { sendPlatformEmail } from "@/lib/platform-email";
import { isPublicAddress } from "@/lib/public-address";
import { checkSegmentRules, compileSegment } from "@/lib/segments";
import { queueAutomationEmail } from "@/lib/sending";
import { DEFAULT_TIME_ZONE, resolveTimeZone, shiftDateKey, toDateKey } from "@/lib/time-zone";
import Account from "@/models/Account";
import Automation from "@/models/Automation";
import AutomationEmail from "@/models/AutomationEmail";
import AutomationRun from "@/models/AutomationRun";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

// The automations cron, every minute: date triggers let their contacts in, then every pass that's due takes its steps
// until a delay or the end. A pass is claimed before it runs, so two crons never run the same step.
const CLAIM_MS = 5 * 60_000;
const BUDGET_MS = 45_000;
const MAX_RUNS_PER_TICK = 500;
// Steps one pass takes in a tick at most: a tree has MAX_STEPS, so only a loop would get this far.
const MAX_STEPS_PER_TICK = 60;
const HISTORY_KEPT = 100;
const SENDING_OFF_RETRY_MS = 15 * 60_000;
const WEBHOOK_TIMEOUT_MS = 10_000;
const MAX_WEBHOOK_BODY = 10_000;
const DATE_TRIGGER_CHUNK = 1000;
const CROSS = { crossAccount: true };

function toObjectId(value) {
	return new mongoose.Types.ObjectId(String(value));
}

export function getWebhookSignature(secret, body) {
	return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function newWebhookSecret() {
	return crypto.randomBytes(24).toString("hex");
}

// Who an Internal notification can go to: the account's owner, and on a self-hosted server its admins.
export async function listNotifyRecipients(account) {
	const owner = await findOwnerEmail(account._id);
	return [...new Set([owner, ...(isCloud() ? [] : getAdminEmails())].filter(Boolean))];
}

function getTimeZone(account) {
	return resolveTimeZone(account?.summary?.timeZone ?? DEFAULT_TIME_ZONE);
}

function localTime(date, timeZone) {
	return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

// Only from a public address: the lookup is checked when the connection opens, so a host can't pass the check with one
// address and connect to another. No redirects; the answer's body is never read beyond its status.
function postJson(url, body, headers) {
	return new Promise((resolve, reject) => {
		const lookup = (hostname, options, callback) =>
			dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
				if (error) return callback(error);
				if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
					return callback(new Error("The webhook link points at an address Mailer can't reach"));
				}
				if (options.all) return callback(null, addresses);
				return callback(null, addresses[0].address, addresses[0].family);
			});
		const request = https.request(
			url,
			{ method: "POST", lookup, timeout: WEBHOOK_TIMEOUT_MS, headers: { "content-type": "application/json", ...headers } },
			(response) => {
				response.resume();
				resolve(response.statusCode);
			}
		);
		request.on("timeout", () => request.destroy(new Error("The webhook took too long to answer")));
		request.on("error", reject);
		request.end(body);
	});
}

export async function sendWebhook({ url, secret, payload }) {
	if (!url?.startsWith("https://")) return "skipped: not an https link";
	// An address in the link itself is never looked up, so it's checked here.
	const { hostname, port } = new URL(url);
	if (port) return "failed: webhooks only go to the standard https port";
	const host = hostname.replace(/^\[|\]$/g, "");
	if (net.isIP(host) && !isPublicAddress(host)) return "failed: the webhook link points at an address Mailer can't reach";
	const body = JSON.stringify(payload).slice(0, MAX_WEBHOOK_BODY);
	try {
		const status = await postJson(url, body, {
			"user-agent": "Mailer-Automations",
			"x-mailer-signature": `sha256=${getWebhookSignature(secret ?? "", body)}`,
		});
		return status >= 200 && status < 300 ? `sent (${status})` : `failed (${status})`;
	} catch (error) {
		return `failed: ${String(error?.message ?? error).slice(0, 120)}`;
	}
}

function contactPayload(contact) {
	return {
		id: String(contact._id),
		email: contact.email,
		firstName: contact.firstName ?? null,
		status: contact.status,
		tags: contact.tags ?? [],
		fields: contact.fields ?? {},
	};
}

async function isConditionMet(account, contact, config, now) {
	const { rules, problem } = checkSegmentRules(config, { fields: account.contactFields ?? [] });
	if (problem) return false;
	return Boolean(await Contact.exists({ accountId: account._id, _id: contact._id, $and: [compileSegment(rules, { now })] }));
}

// A tag trigger that lets contacts out once they leave its tags or join an excluded one.
function hasLeftTrigger(automation, contact) {
	const { type, config } = automation.trigger ?? {};
	if (type !== "tag_added" || !config?.exitOnLeave) return false;
	const tags = contact.tags ?? [];
	return !config.tags?.some((tag) => tags.includes(tag)) || Boolean(config.exclude?.some((tag) => tags.includes(tag)));
}

// One step for one contact: what happened, in a word or two for the pass's history, and for a condition the branch.
// retryAt: the step couldn't run yet and goes again then. stop: the pass ends here, canceled or failed.
async function runStep({ account, automation, newsletter, contact, step, run, now }) {
	const config = step.config ?? {};
	const actor = { via: "automation" };
	switch (step.type) {
		case "condition": {
			const isMet = await isConditionMet(account, contact, config, now);
			return { result: isMet ? "yes" : "no", branch: isMet ? "yes" : "no" };
		}
		case "email": {
			if (!isSendingEnabled()) return { retryAt: new Date(now.getTime() + SENDING_OFF_RETRY_MS), result: "sending is off" };
			const email = config.emailId ? await AutomationEmail.findOne({ accountId: account._id, _id: config.emailId }).lean() : null;
			if (!email) return { stop: "failed", result: "the email is missing" };
			const sent = await queueAutomationEmail({ account, newsletter, contact, email, run });
			if (sent.skipped === "already sent") return { result: "sent" };
			if (sent.skipped) return { stop: contact.status === "active" ? "failed" : "canceled", result: sent.skipped };
			if (sent.failed) return { stop: "failed", result: "the email failed" };
			return { result: sent.retry ? "queued" : sent.suppressed ? "suppressed" : "sent" };
		}
		case "tags_copy":
			await changeContactTags(account, { contactIds: [contact._id], add: config.tags ?? [] });
			return { result: "tags added" };
		case "tags_move": {
			await changeContactTags(account, { contactIds: [contact._id], add: config.tags ?? [] });
			const triggerTags = automation.trigger?.type === "tag_added" ? (automation.trigger.config?.tags ?? []) : [];
			const remove = triggerTags.filter((tag) => !config.tags?.includes(tag));
			if (remove.length > 0) await changeContactTags(account, { contactIds: [contact._id], remove });
			return { result: "tags moved" };
		}
		case "tags_remove":
			await changeContactTags(account, { contactIds: [contact._id], remove: config.tags ?? [] });
			return { result: "tags removed" };
		case "field_update": {
			const field = (account.contactFields ?? []).find(({ key }) => key === config.field);
			if (!field) return { stop: "failed", result: "the field was deleted" };
			const { value, problem } = readFieldValue(field.type, config.value);
			if (problem) return { stop: "failed", result: `the value isn't ${problem}` };
			await updateContactDetails(account, contact, { fields: { [field.key]: value } });
			return { result: "field updated" };
		}
		case "unsubscribe": {
			const { problem } = await changeContactStatus({ account, contact, status: "unsubscribed", actor });
			return { result: problem ? `not unsubscribed: ${problem.message}` : "unsubscribed" };
		}
		case "webhook": {
			const result = await sendWebhook({
				url: config.url,
				secret: automation.webhookSecret,
				payload: {
					event: "automation.step",
					automation: { id: String(automation._id), name: automation.name },
					step: { id: step.id },
					contact: contactPayload(contact),
					sentAt: now.toISOString(),
				},
			});
			return { result };
		}
		case "notify": {
			const to = await listNotifyRecipients(account);
			const lines = [
				`${contact.email} reached a step of the automation "${automation.name}".`,
				config.note ? `\n${config.note}` : "",
				`\n${getAppUrl()}/automations/${automation._id}`,
			];
			for (const address of to) {
				await sendPlatformEmail({ to: address, subject: `${automation.name}: ${contact.email}`, text: lines.join("\n") }).catch((error) =>
					console.error("[automations] Notification not sent:", error.message)
				);
			}
			return { result: "notified" };
		}
		default:
			// A step that isn't available (A/B test, Move to step) is passed over.
			return { result: "skipped" };
	}
}

// Takes the pass's steps from where it is, until a delay, the end, or a stop. Returns the pass's update.
export async function advanceRun({ account, automation, newsletter, run, now = new Date() }) {
	const history = [];
	const finish = (status, reason) => ({ status, reason, finishedAt: now, nextAt: null, history });
	let contact = await Contact.findOne({ accountId: account._id, _id: run.contactId }).lean();
	if (!contact) return finish("canceled", "the contact was deleted");

	let step = findStep(automation.steps ?? [], run.stepId);
	// Its step is gone: removed while nobody waited on it, or the pass was let in before the first step changed.
	if (!step) return finish("completed", "the step was removed");
	// A delay it already waited out goes on to the next step.
	if (step.type === "delay" && run.waitingOn === step.id) step = findNextStep(automation.steps, step.id);

	for (let taken = 0; step && taken < MAX_STEPS_PER_TICK; taken++) {
		if (contact.status !== "active") return finish("canceled", `the contact is ${contact.status}`);
		if (hasLeftTrigger(automation, contact)) return finish("canceled", "the contact left the trigger's tags");
		if (step.type === "delay") {
			history.push({ stepId: step.id, type: step.type, at: now, result: "waiting" });
			return { stepId: step.id, waitingOn: step.id, nextAt: new Date(now.getTime() + getDelayMs(step.config)), history };
		}
		let outcome;
		try {
			outcome = await runStep({ account, automation, newsletter, contact, step, run, now });
		} catch (error) {
			console.error(`[automations] Step ${step.type} of ${automation._id} failed:`, error);
			history.push({ stepId: step.id, type: step.type, at: now, result: "error" });
			return finish("failed", String(error?.message ?? error).slice(0, 200));
		}
		if (outcome.retryAt) return { stepId: step.id, nextAt: outcome.retryAt, history };
		history.push({ stepId: step.id, type: step.type, at: now, result: outcome.result });
		if (outcome.stop) return finish(outcome.stop, outcome.result);
		const next = outcome.branch ? step[outcome.branch]?.[0] : findNextStep(automation.steps, step.id);
		step = next ?? null;
		// The step may have changed the contact: its tags, a field, its status.
		contact = (await Contact.findOne({ accountId: account._id, _id: contact._id }).lean()) ?? contact;
	}
	if (step) return { stepId: step.id, nextAt: now, history };
	return finish("completed", null);
}

function claimDueRun(automationIds, now) {
	return AutomationRun.findOneAndUpdate(
		{
			status: "waiting",
			nextAt: { $lte: now },
			automationId: { $in: automationIds },
			$or: [{ claimedUntil: null }, { claimedUntil: { $lte: now } }],
		},
		{ $set: { claimedUntil: new Date(now.getTime() + CLAIM_MS) } },
		{ ...CROSS, sort: { nextAt: 1 }, returnDocument: "after" }
	).lean();
}

async function saveRun(run, update) {
	const { history = [], ...set } = update;
	await AutomationRun.updateOne(
		{ accountId: run.accountId, _id: run._id },
		{
			$set: set,
			$unset: { claimedUntil: 1 },
			...(history.length > 0 && { $push: { history: { $each: history, $slice: -HISTORY_KEPT } } }),
		}
	);
}

// Exact date: once, every active contact of the newsletter (with its tags, if it names some). Anniversary: every day at
// its time in the account's timezone, the contacts whose date field falls on that day of the year, offset by its days.
async function fireDateTriggers(automations, accounts, now) {
	let enrolled = 0;
	for (const automation of automations) {
		const { type, config = {} } = automation.trigger ?? {};
		const account = accounts.get(String(automation.accountId));
		if (!account || isBlocked(account)) continue;
		let filter = null;
		if (type === "exact_date" && config.at && new Date(config.at) <= now && !automation.firedAt) {
			const { modifiedCount } = await Automation.updateOne(
				{ accountId: automation.accountId, _id: automation._id, firedAt: null },
				{ $set: { firedAt: now } }
			);
			if (!modifiedCount) continue;
			filter = config.tags?.length ? { tags: { $in: config.tags } } : {};
		}
		if (type === "anniversary" && config.field) {
			const field = (account.contactFields ?? []).find(({ key, type: fieldType }) => key === config.field && fieldType === "date");
			const timeZone = getTimeZone(account);
			const today = toDateKey(now, timeZone);
			if (!field || automation.firedOn === today || localTime(now, timeZone) < config.time) continue;
			const { modifiedCount } = await Automation.updateOne(
				{ accountId: automation.accountId, _id: automation._id, firedOn: automation.firedOn ?? null },
				{ $set: { firedOn: today } }
			);
			if (!modifiedCount) continue;
			// offsetDays after the anniversary, or before it when negative: the date's day of the year is today minus them.
			const day = shiftDateKey(today, -(config.offsetDays ?? 0)).slice(5);
			const path = `fields.${field.key}`;
			filter = { [path]: { $type: "date" }, $expr: { $eq: [{ $dateToString: { format: "%m-%d", date: `$${path}` } }, day] } };
		}
		if (!filter) continue;
		const cursor = Contact.find({ accountId: automation.accountId, newsletterId: automation.newsletterId, status: "active", ...filter })
			.select({ _id: 1, newsletterId: 1, email: 1, status: 1, tags: 1 })
			.lean()
			.cursor();
		let chunk = [];
		for await (const contact of cursor) {
			chunk.push(contact);
			if (chunk.length >= DATE_TRIGGER_CHUNK) {
				enrolled += await enrollContacts(automation, chunk, { now });
				chunk = [];
			}
		}
		if (chunk.length > 0) enrolled += await enrollContacts(automation, chunk, { now });
	}
	return enrolled;
}

export async function runAutomations({ now = new Date() } = {}) {
	await connectDb();
	const started = Date.now();
	const automations = await Automation.find({ status: "active", deletedAt: null }, null, CROSS).select("+webhookSecret").lean();
	if (automations.length === 0) return { automations: 0, enrolled: 0, runs: 0 };
	const accountIds = [...new Set(automations.map(({ accountId }) => String(accountId)))];
	const accounts = new Map(
		(await Account.find({ _id: { $in: accountIds.map(toObjectId) } }).lean()).map((account) => [String(account._id), account])
	);
	const enrolled = await fireDateTriggers(automations, accounts, now);

	const byId = new Map(automations.map((automation) => [String(automation._id), automation]));
	const newsletters = new Map();
	const live = automations.filter(({ accountId }) => !isBlocked(accounts.get(String(accountId)))).map(({ _id }) => _id);
	let runs = 0;
	while (runs < MAX_RUNS_PER_TICK && Date.now() - started < BUDGET_MS) {
		const run = await claimDueRun(live, now);
		if (!run) break;
		runs++;
		const automation = byId.get(String(run.automationId));
		const account = accounts.get(String(run.accountId));
		const key = String(run.newsletterId);
		if (!newsletters.has(key)) newsletters.set(key, await Newsletter.findOne({ accountId: run.accountId, _id: run.newsletterId }).lean());
		const newsletter = newsletters.get(key);
		const update = newsletter
			? await advanceRun({ account, automation, newsletter, run, now })
			: { status: "canceled", reason: "the newsletter was deleted", finishedAt: now, nextAt: null };
		await saveRun(run, update);
	}
	return { automations: automations.length, enrolled, runs };
}

// The waiting passes' steps, so the editor can refuse to remove a step someone waits on: { stepId: count }.
export async function countWaitingByStep(account, automationId) {
	const rows = await AutomationRun.aggregate([
		{ $match: { accountId: toObjectId(account._id), automationId: toObjectId(automationId), status: "waiting" } },
		{ $group: { _id: "$stepId", count: { $sum: 1 } } },
	]);
	return Object.fromEntries(rows.map(({ _id, count }) => [_id, count]));
}

// Steps of the old tree that the new one drops while contacts wait on them.
export function findRemovedWaitingSteps(oldSteps, newSteps, waiting) {
	const kept = new Set([...walkSteps(newSteps)].map(({ step }) => step.id));
	return [...walkSteps(oldSteps)].map(({ step }) => step).filter((step) => !kept.has(step.id) && waiting[step.id] > 0);
}
