import "server-only";
import { isValidObjectId } from "mongoose";
import { after } from "next/server";
import { scoped } from "@/lib/account-scope";
import { FIELD_TYPE_IDS, MAX_CONTACT_FIELDS, fieldKeyFromLabel } from "@/lib/contact-fields";
import { addContactField } from "@/lib/contacts";
import { decryptSecret, encryptSecret } from "@/lib/credentials";
import { MAX_IMPORT_ROWS_PER_REQUEST } from "@/lib/csv-import";
import { connectDb } from "@/lib/db";
import { addImportRows, runImport, startImport } from "@/lib/import-jobs";
import Account from "@/models/Account";
import Campaign from "@/models/Campaign";
import ContactImport from "@/models/ContactImport";
import Newsletter from "@/models/Newsletter";

// Brings a MailerLite account over through its API: subscribers with their status, groups as tags, custom fields, and
// sent campaigns as past issues (email only, never sent again). Contacts go through the same import as a CSV file
// (lib/import-jobs.js), with its checks, so importing again only adds what's new and moves statuses forward: someone who
// unsubscribed in MailerLite since is unsubscribed here, nobody becomes active again.
const API_URL = "https://connect.mailerlite.com/api";
const STATUSES = { active: "active", unsubscribed: "unsubscribed", bounced: "bounced", junk: "complained", unconfirmed: "dormant" };
const FIELD_TYPES = { text: "text", number: "number", date: "date" };
const PAGE_SIZE = 1000;
// An import that says it's running for longer than this died with its server: a new one can start.
const STALE_RUN_MS = 30 * 60 * 1000;
const MAX_RETRIES = 5;

class MailerliteError extends Error {
	constructor(status) {
		super(status === 401 ? "MailerLite didn't accept the API token" : `MailerLite answered ${status}`);
		this.status = status;
	}
}

function tokenContext(account) {
	return `mailerlite:${account._id}`;
}

async function request(token, path, attempt = 0) {
	const response = await fetch(path.startsWith("https://") ? path : `${API_URL}${path}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
		signal: AbortSignal.timeout(60_000),
	});
	// 120 requests a minute: wait as long as it says, then try again.
	if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
		const wait = Number(response.headers.get("retry-after")) || 2 ** attempt;
		await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 60) * 1000));
		return request(token, path, attempt + 1);
	}
	if (!response.ok) throw new MailerliteError(response.status);
	return response.json();
}

// Every page of a list: subscribers page by cursor, groups and campaigns by number; both give links.next.
async function requestAll(token, path) {
	const items = [];
	let next = path;
	while (next) {
		const page = await request(token, next);
		items.push(...(page.data ?? []));
		next = page.links?.next || (page.meta?.next_cursor ? withCursor(path, page.meta.next_cursor) : null);
	}
	return items;
}

function withCursor(path, cursor) {
	const url = new URL(path, `${API_URL}/`);
	url.searchParams.set("cursor", cursor);
	return `${url.pathname.replace(/^\/api/, "")}${url.search}`;
}

async function countSubscribers(token, status) {
	const page = await request(token, `/subscribers?filter[status]=${status}&limit=0`);
	return page.total ?? page.meta?.total ?? 0;
}

// MailerLite's dates are "2024-01-16 10:00:00", in UTC.
function readDate(value) {
	if (!value) return undefined;
	const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value);
	return Number.isFinite(date.getTime()) ? date : undefined;
}

// Rates come as 0.51 or 51 depending on the endpoint.
function readRate(value) {
	const number = Number(value?.float ?? value);
	if (!Number.isFinite(number) || number < 0) return undefined;
	return number > 1 ? number / 100 : number;
}

async function readToken(account) {
	const stored = await Account.findById(account._id).select({ "mailerlite.token": 1 }).lean();
	const value = stored?.mailerlite?.token;
	return value ? decryptSecret(value, { context: tokenContext(account) }) : null;
}

// ── The page's actions ─────────────────────────────────────────────────────────────────────────────────────────────

export async function saveMailerliteToken(account, input) {
	const token = String(input ?? "").trim();
	if (token.length < 20) return { error: "Paste the whole API token" };
	try {
		await request(token, "/subscribers?limit=0");
	} catch (error) {
		return { error: error instanceof MailerliteError ? error.message : "Couldn't reach MailerLite, try again" };
	}
	const tokenHint = token.slice(-4);
	await Account.updateOne(
		{ _id: account._id },
		{ $set: { "mailerlite.token": encryptSecret(token, { context: tokenContext(account) }), "mailerlite.tokenHint": tokenHint } }
	);
	return { ok: true, tokenHint };
}

export async function removeMailerliteToken(account) {
	await Account.updateOne({ _id: account._id }, { $unset: { "mailerlite.token": 1, "mailerlite.tokenHint": 1 } });
	return { ok: true };
}

// What an import would bring, counted by MailerLite.
export async function previewMailerlite(account) {
	const token = await readToken(account);
	if (!token) return { error: "Connect MailerLite first" };
	try {
		const statuses = Object.keys(STATUSES);
		const [counts, groups, fields, campaigns] = await Promise.all([
			Promise.all(statuses.map((status) => countSubscribers(token, status))),
			requestAll(token, "/groups?limit=100"),
			requestAll(token, "/fields?limit=100"),
			request(token, "/campaigns?filter[status]=sent&limit=1"),
		]);
		return {
			subscribers: Object.fromEntries(statuses.map((status, index) => [status, counts[index]])),
			groups: groups.map((group) => ({ name: group.name, count: (group.active_count ?? 0) + (group.unsubscribed_count ?? 0) + (group.bounced_count ?? 0) })),
			fields: fields.filter((field) => field.key !== "name").length,
			campaigns: campaigns.meta?.total ?? 0,
		};
	} catch (error) {
		return { error: error instanceof MailerliteError ? error.message : "Couldn't reach MailerLite, try again" };
	}
}

// Starts the import in the background; the page follows it through the account's mailerlite.lastImport.
export async function startMailerliteImport({ account, userId, newsletterId, withCampaigns }) {
	if (!isValidObjectId(newsletterId)) return { error: "Pick a newsletter" };
	const newsletter = await Newsletter.findOne(scoped(account, { _id: newsletterId })).select({ _id: 1 }).lean();
	if (!newsletter) return { error: "Pick a newsletter" };
	if (!(await readToken(account))) return { error: "Connect MailerLite first" };

	const now = new Date();
	const claimed = await Account.updateOne(
		{
			_id: account._id,
			$or: [{ "mailerlite.lastImport.status": { $ne: "running" } }, { "mailerlite.lastImport.startedAt": { $lt: new Date(now - STALE_RUN_MS) } }],
		},
		{ $set: { "mailerlite.lastImport": { status: "running", step: "Reading MailerLite", startedAt: now, newsletterId: String(newsletter._id) } } }
	);
	if (claimed.modifiedCount !== 1) return { error: "An import is already running" };

	after(() =>
		runMailerliteImport({ accountId: account._id, userId, newsletterId: newsletter._id, withCampaigns }).catch(async (error) => {
			console.error(`[mailerlite] Import failed for account ${account._id}: ${error.message}`);
			await Account.updateOne(
				{ _id: account._id },
				{ $set: { "mailerlite.lastImport.status": "failed", "mailerlite.lastImport.error": error.message, "mailerlite.lastImport.finishedAt": new Date() } }
			);
		})
	);
	return { ok: true };
}

// The last import as the page and the API show it.
export async function getMailerliteImport(account) {
	const stored = await Account.findById(account._id).select({ "mailerlite.lastImport": 1 }).lean();
	const run = stored?.mailerlite?.lastImport;
	if (!run) return null;
	const iso = (date) => (date ? new Date(date).toISOString() : null);
	return {
		status: run.status,
		step: run.step ?? null,
		startedAt: iso(run.startedAt),
		finishedAt: iso(run.finishedAt),
		error: run.error ?? null,
		result: run.result ? { ...run.result, campaigns: run.result.campaigns ?? null } : null,
	};
}

// ── The import ─────────────────────────────────────────────────────────────────────────────────────────────────────

function setStep(accountId, step) {
	return Account.updateOne({ _id: accountId }, { $set: { "mailerlite.lastImport.step": step } });
}

async function runMailerliteImport({ accountId, userId, newsletterId, withCampaigns }) {
	await connectDb();
	let account = await Account.findById(accountId).lean();
	const token = await readToken(account);
	if (!token) throw new Error("MailerLite isn't connected any more");

	await setStep(accountId, "Reading subscribers");
	const subscribers = new Map();
	for (const status of Object.keys(STATUSES)) {
		for (const subscriber of await requestAll(token, `/subscribers?filter[status]=${status}&limit=${PAGE_SIZE}`)) {
			subscribers.set(subscriber.email.toLowerCase(), { ...subscriber, status });
		}
	}

	await setStep(accountId, "Reading groups");
	const groups = await requestAll(token, "/groups?limit=100");
	const tags = new Map();
	for (const group of groups) {
		for (const status of Object.keys(STATUSES)) {
			for (const member of await requestAll(token, `/groups/${group.id}/subscribers?filter[status]=${status}&limit=${PAGE_SIZE}`)) {
				const email = member.email.toLowerCase();
				tags.set(email, [...(tags.get(email) ?? []), group.name]);
			}
		}
	}

	await setStep(accountId, "Setting up fields");
	const fieldMap = await setUpFields(account, await requestAll(token, "/fields?limit=100"), [...subscribers.values()]);
	account = await Account.findById(accountId).lean();

	const rows = [...subscribers.entries()].map(([email, subscriber]) => toRow(email, subscriber, tags.get(email), fieldMap.keys));
	await setStep(accountId, `Importing ${rows.length} contacts`);
	const contactImport = await importRows({ account, userId, newsletterId, rows });

	let campaigns = null;
	if (withCampaigns) {
		await setStep(accountId, "Importing past campaigns");
		campaigns = await importCampaigns({ account, newsletterId, token });
	}

	await Account.updateOne(
		{ _id: accountId },
		{
			$set: {
				"mailerlite.lastImport.status": "done",
				"mailerlite.lastImport.step": "Done",
				"mailerlite.lastImport.finishedAt": new Date(),
				"mailerlite.lastImport.importId": String(contactImport._id),
				"mailerlite.lastImport.result": {
					subscribers: rows.length,
					created: contactImport.created ?? 0,
					existing: contactImport.existing ?? 0,
					dropped: Object.values(contactImport.dropped ?? {}).reduce((sum, count) => sum + (count ?? 0), 0),
					groups: groups.length,
					fields: fieldMap.imported,
					skippedFields: fieldMap.skipped,
					campaigns,
				},
			},
		}
	);
}

// The account's fields for MailerLite's: the ones with values, most used first, while there's room (MAX_CONTACT_FIELDS).
// A field with the same key already there is used as it is. Their name goes to the first name instead.
async function setUpFields(account, mailerliteFields, subscribers) {
	const used = new Map();
	for (const subscriber of subscribers) {
		for (const [key, value] of Object.entries(subscriber.fields ?? {})) {
			if (value !== null && value !== "") used.set(key, (used.get(key) ?? 0) + 1);
		}
	}
	const candidates = mailerliteFields
		.filter((field) => field.key !== "name" && used.has(field.key))
		.sort((a, b) => used.get(b.key) - used.get(a.key));

	const existing = [...(account.contactFields ?? [])];
	const keys = {};
	const imported = [];
	const skipped = [];
	for (const field of candidates) {
		const label = field.name.trim().slice(0, 40);
		const key = fieldKeyFromLabel(label);
		const type = FIELD_TYPES[field.type] ?? "text";
		if (existing.some((own) => own.key === key)) {
			keys[field.key] = key;
			imported.push(label);
			continue;
		}
		if (existing.length >= MAX_CONTACT_FIELDS || !FIELD_TYPE_IDS.includes(type)) {
			skipped.push(label);
			continue;
		}
		const { field: created, problem } = await addContactField({ ...account, contactFields: existing }, { label, type });
		if (problem) {
			skipped.push(label);
			continue;
		}
		existing.push(created);
		keys[field.key] = created.key;
		imported.push(label);
	}
	return { keys, imported, skipped };
}

function toRow(email, subscriber, groupNames = [], fieldKeys) {
	const fields = Object.fromEntries(
		Object.entries(subscriber.fields ?? {})
			.filter(([key, value]) => fieldKeys[key] && value !== null && value !== "")
			.map(([key, value]) => [fieldKeys[key], value])
	);
	return {
		email,
		status: STATUSES[subscriber.status],
		subscribedAt: readDate(subscriber.subscribed_at ?? subscriber.created_at),
		firstName: subscriber.fields?.name ?? undefined,
		tags: groupNames,
		fields,
		emailsReceived: subscriber.sent ?? undefined,
		openRate: readRate(subscriber.open_rate),
		clickRate: readRate(subscriber.click_rate),
		opens: subscriber.opens_count ?? undefined,
		clicks: subscriber.clicks_count ?? undefined,
	};
}

// Through the dashboard's import, consent included (the people subscribed in MailerLite), then run here at once.
async function importRows({ account, userId, newsletterId, rows }) {
	const { contactImport, error } = await startImport({
		account,
		userId,
		newsletterId,
		consent: true,
		source: "mailerlite",
		fileName: "MailerLite",
		total: rows.length,
	});
	if (error) throw new Error(error);
	for (let start = 0; start < rows.length; start += MAX_IMPORT_ROWS_PER_REQUEST) {
		const added = await addImportRows({
			account,
			importId: String(contactImport._id),
			newsletterId,
			rows: rows.slice(start, start + MAX_IMPORT_ROWS_PER_REQUEST),
			run: false,
		});
		if (added.error) throw new Error(added.error);
	}
	await runImport({ accountId: String(account._id), importId: String(contactImport._id), index: 0 }, { budgetMs: Number.POSITIVE_INFINITY });
	return ContactImport.findOne(scoped(account, { _id: contactImport._id })).lean();
}

// Sent campaigns as past issues: sent, email only (off the website), with MailerLite's numbers. Their links and merge
// tags are MailerLite's, so they're there to read, not to send again.
async function importCampaigns({ account, newsletterId, token }) {
	const campaigns = await requestAll(token, "/campaigns?filter[status]=sent&limit=100");
	let created = 0;
	let updated = 0;
	for (const campaign of campaigns) {
		const { data } = await request(token, `/campaigns/${campaign.id}`);
		const email = data.emails?.[0] ?? {};
		const stats = data.stats ?? {};
		const startedAt = readDate(data.started_at);
		const finishedAt = readDate(data.finished_at) ?? startedAt;
		const result = await Campaign.updateOne(
			scoped(account, { newsletterId, externalId: `mailerlite:${campaign.id}` }),
			{
				$set: {
					subject: String(email.subject || data.name || "").trim(),
					previewText: String(email.preheader ?? "").trim(),
					format: "html",
					html: email.content ?? "",
					status: "sent",
					publishTo: "email",
					source: "mailerlite",
					startedAt,
					sentAt: finishedAt,
					finishedAt,
					stats: {
						recipients: stats.sent ?? 0,
						sent: stats.sent ?? 0,
						delivered: stats.deliveries_count ?? 0,
						bounced: (stats.hard_bounces_count ?? 0) + (stats.soft_bounces_count ?? 0),
						complained: stats.spam_count ?? 0,
						opened: stats.opens_count ?? 0,
						clicked: stats.clicks_count ?? 0,
						unsubscribed: stats.unsubscribes_count ?? 0,
						failed: 0,
					},
					updatedAt: new Date(),
				},
				$setOnInsert: { createdAt: readDate(data.created_at) ?? new Date() },
			},
			{ upsert: true, timestamps: false }
		);
		if (result.upsertedCount) created += 1;
		else updated += 1;
	}
	return { created, updated };
}
