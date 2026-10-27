import "server-only";
import mongoose from "mongoose";
import { withoutUtm } from "@/lib/utm";
import Automation from "@/models/Automation";
import AutomationRun from "@/models/AutomationRun";
import Contact from "@/models/Contact";

// Lets contacts into automations when what their triggers watch happens: a tag added, a field changed, a link clicked
// (lib/contacts.js, lib/email-events.js call these). Nothing runs here: each contact gets an AutomationRun due now, and
// the automations cron (lib/automations.js) takes the steps. Kept apart from lib/automations.js, which changes contacts
// through lib/contacts.js, so the two don't import each other.

const ENROLL_CHUNK = 1000;
const CONTACT_FIELDS = { _id: 1, accountId: 1, newsletterId: 1, email: 1, status: 1, tags: 1 };

function toObjectId(value) {
	return new mongoose.Types.ObjectId(String(value));
}

function findLiveAutomations(accountId, type, filter = {}) {
	return Automation.find({ accountId: toObjectId(accountId), status: "active", deletedAt: null, "trigger.type": type, ...filter }).lean();
}

// Tags a tag trigger watches among these, so a change of other tags costs nothing more.
export async function findWatchedTags(accountId, tags) {
	if (!tags?.length) return [];
	const automations = await findLiveAutomations(accountId, "tag_added", { "trigger.config.tags": { $in: tags } });
	const watched = new Set(automations.flatMap(({ trigger }) => trigger.config?.tags ?? []));
	return tags.filter((tag) => watched.has(tag));
}

// Lets the contacts in, those it can: active ones, not already in it, and only once unless it lets contacts in again.
// via: the trigger, or "manual". How many got in.
export async function enrollContacts(automation, contacts, { via = automation.trigger?.type, now = new Date() } = {}) {
	const firstStep = automation.steps?.[0];
	if (automation.status !== "active" || !firstStep) return 0;
	const exclude = automation.trigger?.type === "tag_added" ? (automation.trigger.config?.exclude ?? []) : [];
	const candidates = contacts.filter(
		(contact) =>
			contact.status === "active" &&
			String(contact.newsletterId) === String(automation.newsletterId) &&
			!exclude.some((tag) => contact.tags?.includes(tag))
	);
	let enrolled = 0;
	for (let start = 0; start < candidates.length; start += ENROLL_CHUNK) {
		const chunk = candidates.slice(start, start + ENROLL_CHUNK);
		const known = await AutomationRun.distinct("contactId", {
			accountId: automation.accountId,
			automationId: automation._id,
			contactId: { $in: chunk.map(({ _id }) => _id) },
			...(automation.reenter && { status: "waiting" }),
		});
		const skip = new Set(known.map(String));
		const runs = chunk
			.filter(({ _id }) => !skip.has(String(_id)))
			.map((contact) => ({
				accountId: automation.accountId,
				automationId: automation._id,
				newsletterId: automation.newsletterId,
				contactId: contact._id,
				email: contact.email,
				stepId: firstStep.id,
				nextAt: now,
				via,
			}));
		if (runs.length === 0) continue;
		try {
			const inserted = await AutomationRun.insertMany(runs, { ordered: false });
			enrolled += inserted.length;
		} catch (error) {
			// A contact the same trigger let in a moment ago keeps its one run.
			const codes = (error?.writeErrors ?? []).map(({ err, code }) => err?.code ?? code);
			if (!(codes.length > 0 && codes.every((code) => code === 11000))) throw error;
			enrolled += runs.length - codes.length;
		}
	}
	return enrolled;
}

// changes: [{ _id, tags: the tags the contact just got }].
export async function onTagsAdded(accountId, changes) {
	const added = [...new Set(changes.flatMap(({ tags }) => tags))];
	if (added.length === 0) return 0;
	const automations = await findLiveAutomations(accountId, "tag_added", { "trigger.config.tags": { $in: added } });
	if (automations.length === 0) return 0;
	const byId = new Map(changes.map((change) => [String(change._id), change.tags]));
	const contacts = await Contact.find({ accountId: toObjectId(accountId), _id: { $in: changes.map(({ _id }) => _id) } })
		.select(CONTACT_FIELDS)
		.lean();
	let enrolled = 0;
	for (const automation of automations) {
		const watched = automation.trigger.config.tags;
		const gaining = contacts.filter((contact) => byId.get(String(contact._id))?.some((tag) => watched.includes(tag)));
		enrolled += await enrollContacts(automation, gaining);
	}
	return enrolled;
}

// fields: the keys of the contact's fields that changed.
export async function onFieldsChanged(accountId, contact, fields) {
	if (!fields?.length || !contact) return 0;
	const automations = await findLiveAutomations(accountId, "field_updated", { "trigger.config.field": { $in: fields } });
	let enrolled = 0;
	for (const automation of automations) enrolled += await enrollContacts(automation, [contact]);
	return enrolled;
}

// Exact: the link as written, with or without a trailing slash; prefix: any link that starts with it. UTM parameters an
// email added don't count.
export function isLinkMatch(config, clicked) {
	const target = String(config?.url ?? "").trim();
	if (!target || !clicked) return false;
	const url = withoutUtm(clicked);
	if (config.match === "prefix") return url.startsWith(target);
	const trim = (value) => value.replace(/\/+$/, "");
	return trim(url) === trim(target);
}

// A click in any email of the contact's newsletter.
export async function onLinkClicked({ accountId, contactId, url }) {
	if (!contactId || !url) return 0;
	const automations = await findLiveAutomations(accountId, "link_clicked");
	const matching = automations.filter(({ trigger }) => isLinkMatch(trigger.config, url));
	if (matching.length === 0) return 0;
	const contact = await Contact.findOne({ accountId: toObjectId(accountId), _id: contactId }).select(CONTACT_FIELDS).lean();
	if (!contact) return 0;
	let enrolled = 0;
	for (const automation of matching) enrolled += await enrollContacts(automation, [contact]);
	return enrolled;
}

// Triggers never break what fired them: a tag still gets added, a click still redirects.
export async function safely(label, run) {
	try {
		return await run();
	} catch (error) {
		console.error(`[automations] ${label}:`, error);
		return 0;
	}
}
