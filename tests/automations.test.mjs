import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	cleanStepConfig,
	cleanTriggerConfig,
	findNextStep,
	listIncompleteSteps,
	removeStep,
	updateList,
} from "../lib/automation-steps.js";
import { renderEmail } from "../lib/render-email.js";
import { readClickToken } from "../lib/tracking.js";
import { addUtm, withoutUtm } from "../lib/utm.js";
import { activate, as, callApi, catchRedirect, form, platformEmails, signIn, startTestApp } from "./helpers/app.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

// A trigger lets contacts in (lib/automation-triggers.js) and the automations cron takes their steps (lib/automations.js),
// each pass at most once at a time. Times are passed in, so delays and date triggers run without waiting.
const DAY_MS = 86_400_000;
let app;
let m;

before(async () => {
	app = await startTestApp();
	m = {
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		automations: await import("../lib/automations.js"),
		triggers: await import("../lib/automation-triggers.js"),
		AutomationRun: (await import("../models/AutomationRun.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		Message: (await import("../models/Message.js")).default,
		TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
		pages: {
			list: await import("../app/(app)/automations/page.js"),
			new: await import("../app/(app)/automations/new/page.js"),
			editor: await import("../app/(app)/automations/[id]/page.js"),
			email: await import("../app/(app)/automations/[id]/emails/[emailId]/page.js"),
			activity: await import("../app/(app)/automations/[id]/activity/page.js"),
		},
	};
});

after(() => app?.stop());

async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	const slug = email.split("@")[0].replace(/[^a-z0-9]/g, "-");
	const url = await as(user, () =>
		catchRedirect(
			m.newsletters.saveNewsletter(
				null,
				form({ name: `${slug} news`, slug, fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris" })
			)
		)
	);
	user.newsletterId = url.split("/").at(-1);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	return user;
}

async function api(user, method, path, body) {
	const response = await callApi(method, `/api/v1${path}`, { key: user.key, body });
	assert.ok(response.status < 300, `${method} ${path}: ${JSON.stringify(response.body)}`);
	return response.body;
}

// An automation with one email, ready to start: trigger and steps as given, the email's id put in its steps.
async function automationWith(user, { trigger, steps, reenter }) {
	const automation = await api(user, "POST", "/automations", { name: "Test flow" });
	const email = await api(user, "POST", `/automations/${automation.id}/emails`, {});
	await api(user, "PATCH", `/automations/${automation.id}/emails/${email.id}`, {
		subject: "Hi {{first_name|friend}}",
		content: '<p>Hello there. <a href="https://example.com/shop">Shop</a></p>',
		language: "uk",
		utm: { enabled: true, source: user.email.split("@")[0], medium: "email", campaign: "hello" },
	});
	const withEmail = JSON.parse(JSON.stringify(steps).replaceAll('"EMAIL"', JSON.stringify(email.id)));
	return api(user, "PATCH", `/automations/${automation.id}`, { trigger, steps: withEmail, ...(reenter !== undefined && { reenter }) });
}

function runsOf(user, automation) {
	return m.AutomationRun.find({ accountId: user.accountId, automationId: automation.id }).lean();
}

describe("automation steps", () => {
	const steps = [
		{ id: "aaaa", type: "delay", config: { amount: 1, unit: "days" } },
		{
			id: "bbbb",
			type: "condition",
			config: { match: "all", conditions: [{ field: "tag", op: "has", value: "vip" }] },
			yes: [{ id: "cccc", type: "tags_copy", config: { tags: ["a"] } }, { id: "dddd", type: "unsubscribe", config: {} }],
			no: [],
		},
		{ id: "eeee", type: "notify", config: {} },
	];

	test("the next step is the next in its list, and a branch ends at its own end", () => {
		assert.equal(findNextStep(steps, "aaaa").id, "bbbb");
		assert.equal(findNextStep(steps, "cccc").id, "dddd");
		assert.equal(findNextStep(steps, "dddd"), null, "the end of a branch is the way out");
		assert.equal(findNextStep(steps, "eeee"), null);
	});

	test("lists and steps change without touching the others", () => {
		const added = updateList(steps, "bbbb:no", (list) => [...list, { id: "ffff", type: "unsubscribe", config: {} }]);
		assert.equal(added[1].no[0].id, "ffff");
		assert.equal(steps[1].no.length, 0);
		assert.deepEqual(removeStep(added, "cccc")[1].yes.map(({ id }) => id), ["dddd"]);
	});

	test("settings come out clean, and what's missing is listed", () => {
		assert.deepEqual(cleanTriggerConfig("tag_added", { tags: [" VIP ", "vip", ""], other: 1 }), { tags: ["vip"], exclude: [], exitOnLeave: false });
		assert.deepEqual(cleanStepConfig("delay", { amount: 900, unit: "hours" }), { amount: 23, unit: "hours" });
		assert.deepEqual(cleanStepConfig("webhook", { url: "http://example.com/hook" }), { url: "" }, "webhooks are https only");
		assert.deepEqual(cleanStepConfig("webhook", { url: "https://example.com:6379/hook" }), { url: "" }, "on the standard port");
		assert.deepEqual(cleanTriggerConfig("link_clicked", { url: "javascript:alert(1)" }), { url: "", match: "exact" });
		const problems = listIncompleteSteps({ trigger: { type: "tag_added", config: { tags: [] } }, steps: [{ id: "aaaa", type: "email", config: {} }] });
		assert.deepEqual(problems, [
			{ id: "trigger", problem: "Pick at least one tag" },
			{ id: "aaaa", problem: "Set up the email" },
		]);
		assert.equal(listIncompleteSteps({ trigger: { type: "segment" }, steps })[0].problem, "This trigger isn't available yet");
	});

	test("UTM parameters go on an email's links, never over the link's own or into merge tags", () => {
		const utm = { enabled: true, source: "news", medium: "email", campaign: "welcome" };
		const html = '<a href="https://example.com/a?x=1&amp;y=2">A</a><a href="https://example.com/b?utm_source=own">B</a><a href="https://example.com/{{email}}">C</a><a href="mailto:a@example.com">D</a>';
		assert.equal(
			addUtm(html, utm),
			'<a href="https://example.com/a?x=1&amp;y=2&amp;utm_source=news&amp;utm_medium=email&amp;utm_campaign=welcome">A</a><a href="https://example.com/b?utm_source=own">B</a><a href="https://example.com/{{email}}">C</a><a href="mailto:a@example.com">D</a>'
		);
		assert.equal(addUtm(html, { ...utm, enabled: false }), html);
		assert.equal(withoutUtm("https://example.com/a?x=1&utm_source=news"), "https://example.com/a?x=1");
	});

	test("an email's footer speaks its newsletter's language, or the email's own", () => {
		const newsletter = { name: "Morkva", postalAddress: "Kyiv" };
		const english = renderEmail({ format: "rich", html: "<p>Hi</p>", subject: "S", newsletter });
		assert.match(english.html, /<html lang="en">/);
		assert.match(english.html, /Unsubscribe/);
		const ukrainian = renderEmail({ format: "rich", html: "<p>Hi</p>", subject: "S", newsletter: { ...newsletter, language: "uk" }, webUrl: "https://example.com/p/s" });
		assert.match(ukrainian.html, /<html lang="uk">/);
		assert.match(ukrainian.html, /Ви отримали цей лист, бо підписалися на Morkva\./);
		assert.match(ukrainian.html, /Відписатися/);
		assert.match(ukrainian.text, /Читати онлайн: https:\/\/example\.com\/p\/s/);
		assert.match(renderEmail({ format: "rich", html: "<p>Hi</p>", subject: "S", newsletter, language: "uk" }).html, /Відписатися/, "the email picks");
	});

	test("an exact link matches with or without its trailing slash, a prefix any link under it", () => {
		const { isLinkMatch } = m.triggers;
		assert.equal(isLinkMatch({ url: "https://example.com/promo/", match: "exact" }, "https://example.com/promo"), true);
		assert.equal(isLinkMatch({ url: "https://example.com/promo", match: "exact" }, "https://example.com/promo/x"), false);
		assert.equal(isLinkMatch({ url: "https://example.com/promo", match: "prefix" }, "https://example.com/promo/x"), true);
		assert.equal(isLinkMatch({ url: "https://example.com/promo", match: "exact" }, "https://example.com/promo?utm_source=news"), true, "UTM parameters don't count");
	});
});

describe("running automations", () => {
	test("a tag lets the contact in: the email goes, the delay waits, then the next step runs", async () => {
		const user = await customer("flow-tag@example.com");
		const automation = await automationWith(user, {
			trigger: { type: "tag_added", config: { tags: ["lead"] } },
			steps: [
				{ id: "mail", type: "email", config: { emailId: "EMAIL" } },
				{ id: "wait", type: "delay", config: { amount: 2, unit: "days" } },
				{ id: "done", type: "tags_copy", config: { tags: ["nurtured"] } },
			],
		});
		assert.equal(automation.incomplete.length, 0);

		await api(user, "POST", "/contacts", { email: "early@example.com", tags: ["lead"] });
		assert.equal((await runsOf(user, automation)).length, 0, "a draft lets nobody in");

		await api(user, "POST", `/automations/${automation.id}/activate`);
		await api(user, "POST", "/contacts", { email: "jane@example.com", firstName: "Jane", tags: ["lead"] });
		await api(user, "POST", "/contacts", { email: "other@example.com", tags: ["other"] });
		const [run] = await runsOf(user, automation);
		assert.equal(run.email, "jane@example.com");

		const now = new Date();
		await m.automations.runAutomations({ now });
		const email = sesEmails.findLast(({ to }) => to === "jane@example.com");
		assert.equal(email?.subject, "Hi Jane");
		const links = [...email.html.matchAll(/\/c\/([^"]+)"/g)].map(([, token]) => readClickToken(token)?.url);
		assert.ok(links.includes("https://example.com/shop?utm_source=flow-tag&utm_medium=email&utm_campaign=hello"), links.join(" "));
		assert.match(email.html, /Відписатися/, "its own language");
		const waiting = await m.AutomationRun.findOne({ accountId: user.accountId, _id: run._id }).lean();
		assert.deepEqual([waiting.status, waiting.stepId], ["waiting", "wait"]);
		assert.equal(waiting.nextAt.getTime(), now.getTime() + 2 * DAY_MS);

		await m.automations.runAutomations({ now: new Date(now.getTime() + DAY_MS) });
		assert.equal((await m.AutomationRun.findOne({ accountId: user.accountId, _id: run._id }).lean()).status, "waiting", "not before its time");

		await m.automations.runAutomations({ now: new Date(now.getTime() + 2 * DAY_MS + 1000) });
		const done = await m.AutomationRun.findOne({ accountId: user.accountId, _id: run._id }).lean();
		assert.equal(done.status, "completed");
		const contact = await m.Contact.findOne({ accountId: user.accountId, email: "jane@example.com" }).lean();
		assert.deepEqual(contact.tags.toSorted(), ["lead", "nurtured"]);
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: "automation" }), 1);

		const detail = await api(user, "GET", `/automations/${automation.id}`);
		assert.equal(detail.counts.completed, 1);
		assert.equal(detail.emails[0].stats.sent, 1);
		const activity = await api(user, "GET", `/automations/${automation.id}/activity`);
		assert.deepEqual(activity.runs[0].history.map(({ result }) => result), ["sent", "waiting", "tags added"]);

		await api(user, "POST", "/contacts/tag", { contacts: ["jane@example.com"], tags: ["lead"] });
		await api(user, "POST", "/contacts/tag", { contacts: ["early@example.com"], tags: ["lead"] });
		assert.equal((await runsOf(user, automation)).length, 1, "a tag the contact has, or a second pass, lets nobody in again");
	});

	test("a condition picks the branch, and a contact who unsubscribes leaves", async () => {
		const user = await customer("flow-branch@example.com");
		const automation = await automationWith(user, {
			trigger: { type: "tag_added", config: { tags: ["start"] } },
			reenter: true,
			steps: [
				{
					id: "cond",
					type: "condition",
					config: { match: "all", conditions: [{ field: "tag", op: "has", value: "vip" }] },
					yes: [{ id: "yesa", type: "tags_copy", config: { tags: ["was-vip"] } }],
					no: [
						{ id: "wait", type: "delay", config: { amount: 1, unit: "hours" } },
						{ id: "noaa", type: "tags_copy", config: { tags: ["was-not"] } },
					],
				},
			],
		});
		await api(user, "POST", `/automations/${automation.id}/activate`);
		await api(user, "POST", "/contacts", { email: "vip@example.com", tags: ["vip", "start"] });
		await api(user, "POST", "/contacts", { email: "plain@example.com", tags: ["start"] });
		const now = new Date();
		await m.automations.runAutomations({ now });
		const vip = await m.Contact.findOne({ accountId: user.accountId, email: "vip@example.com" }).lean();
		assert.ok(vip.tags.includes("was-vip"));

		const removed = await callApi("PATCH", `/api/v1/automations/${automation.id}`, {
			key: user.key,
			body: { steps: [{ id: "cond", type: "condition", config: { match: "all", conditions: [{ field: "tag", op: "has", value: "vip" }] }, yes: [], no: [] }] },
		});
		assert.equal(removed.status, 409, "a step someone waits at stays");

		const plain = await m.Contact.findOne({ accountId: user.accountId, email: "plain@example.com" }).lean();
		await m.Contact.updateOne({ accountId: user.accountId, _id: plain._id }, { $set: { status: "unsubscribed" } });
		await m.automations.runAutomations({ now: new Date(now.getTime() + 2 * 3_600_000) });
		const run = await m.AutomationRun.findOne({ accountId: user.accountId, contactId: plain._id }).lean();
		assert.deepEqual([run.status, run.reason], ["canceled", "the contact is unsubscribed"]);

		await api(user, "POST", "/contacts/tag", { contacts: ["vip@example.com"], tags: ["again"] });
		await m.Contact.updateOne({ accountId: user.accountId, _id: vip._id }, { $pull: { tags: "start" } });
		await api(user, "POST", "/contacts/tag", { contacts: ["vip@example.com"], tags: ["start"] });
		assert.equal((await m.AutomationRun.countDocuments({ accountId: user.accountId, contactId: vip._id })), 2, "it lets contacts in again");
	});

	test("a paused automation holds its contacts until it's activated again", async () => {
		const user = await customer("flow-pause@example.com");
		const automation = await automationWith(user, {
			trigger: { type: "tag_added", config: { tags: ["go"] } },
			steps: [{ id: "tagd", type: "tags_copy", config: { tags: ["done"] } }],
		});
		await api(user, "POST", `/automations/${automation.id}/activate`);
		await api(user, "POST", "/contacts", { email: "held@example.com", tags: ["go"] });
		await api(user, "POST", `/automations/${automation.id}/pause`);
		await m.automations.runAutomations();
		assert.equal((await runsOf(user, automation))[0].status, "waiting");
		await api(user, "POST", `/automations/${automation.id}/activate`);
		await m.automations.runAutomations();
		assert.equal((await runsOf(user, automation))[0].status, "completed");
	});

	test("a click, a field and a date's anniversary let contacts in, and contacts can be added by hand", async () => {
		const user = await customer("flow-triggers@example.com");
		await callApi("POST", "/api/v1/contacts/fields", { key: user.key, body: { label: "Birthday", type: "date" } });
		await callApi("POST", "/api/v1/contacts/fields", { key: user.key, body: { label: "Plan", type: "text" } });
		const step = [{ id: "tagd", type: "tags_copy", config: { tags: ["done"] } }];
		const click = await automationWith(user, { trigger: { type: "link_clicked", config: { url: "https://example.com/promo", match: "prefix" } }, steps: step });
		const field = await automationWith(user, { trigger: { type: "field_updated", config: { field: "plan" } }, steps: step });
		const birthday = await automationWith(user, { trigger: { type: "anniversary", config: { field: "birthday", offsetDays: 0, time: "00:00" } }, steps: step });
		for (const automation of [click, field, birthday]) await api(user, "POST", `/automations/${automation.id}/activate`);

		const today = new Date().toISOString().slice(5, 10);
		const created = await api(user, "POST", "/contacts", { email: "all@example.com", fields: { birthday: `1990-${today}` } });
		await api(user, "POST", "/contacts", { email: "none@example.com", fields: { birthday: "1990-01-01" === `1990-${today}` ? "1990-01-02" : "1990-01-01" } });
		assert.equal((await runsOf(user, field)).length, 0);

		await m.triggers.onLinkClicked({ accountId: user.accountId, contactId: created.id, url: "https://example.com/promo/october" });
		await m.triggers.onLinkClicked({ accountId: user.accountId, contactId: created.id, url: "https://example.com/other" });
		assert.equal((await runsOf(user, click)).length, 1);

		await api(user, "PATCH", `/contacts/${created.id}/details`, { fields: { plan: "pro" } });
		await api(user, "PATCH", `/contacts/${created.id}/details`, { fields: { plan: "pro" } });
		assert.equal((await runsOf(user, field)).length, 1, "only a change counts");

		await m.automations.runAutomations();
		await m.automations.runAutomations();
		const birthdays = await runsOf(user, birthday);
		assert.deepEqual(birthdays.map(({ email }) => email), ["all@example.com"], "once a day, the contacts whose day it is");

		const manual = await automationWith(user, { trigger: { type: "tag_added", config: { tags: ["never"] } }, steps: step });
		await api(user, "POST", "/contacts/tag", { contacts: ["all@example.com", "none@example.com"], tags: ["batch"] });
		const counted = await api(user, "POST", `/automations/${manual.id}/contacts`, { tag: "batch", countOnly: true });
		assert.deepEqual(counted, { contacts: 2, added: 0 });
		const refused = await callApi("POST", `/api/v1/automations/${manual.id}/contacts`, { key: user.key, body: { tag: "batch" } });
		assert.equal(refused.status, 409, "a draft takes nobody");
		await api(user, "POST", `/automations/${manual.id}/activate`);
		assert.deepEqual(await api(user, "POST", `/automations/${manual.id}/contacts`, { tag: "batch" }), { contacts: 2, added: 2 });
	});

	test("only an automation that's set up starts, and its test emails go to the account", async () => {
		const user = await customer("flow-checks@example.com");
		const automation = await api(user, "POST", "/automations", { name: "Empty" });
		const refused = await callApi("POST", `/api/v1/automations/${automation.id}/activate`, { key: user.key });
		assert.equal(refused.status, 400);
		assert.match(refused.body.error.message, /to finish first: Pick a trigger/);

		const ready = await automationWith(user, {
			trigger: { type: "tag_added", config: { tags: ["x"] } },
			steps: [{ id: "mail", type: "email", config: { emailId: "EMAIL" } }],
		});
		const before = sesEmails.length;
		assert.deepEqual(await api(user, "POST", `/automations/${ready.id}/test`), { to: "flow-checks@example.com", sent: 1 });
		assert.equal(sesEmails.length, before + 1);
		assert.match(sesEmails.at(-1).subject, /^\[Test\] Hi \w+$/, "a sample name fills {{first_name}}");

		const copy = await api(user, "POST", `/automations/${ready.id}/duplicate`);
		assert.equal(copy.status, "draft");
		assert.notEqual(copy.steps[0].config.emailId, ready.steps[0].config.emailId, "the copy has its own email");
		assert.equal(copy.emails[0].subject, "Hi {{first_name|friend}}");

		const other = await customer("flow-other@example.com");
		const foreign = await callApi("GET", `/api/v1/automations/${ready.id}`, { key: other.key });
		assert.equal(foreign.status, 404, "another account's automation isn't there");
		const stolen = await callApi("PATCH", `/api/v1/automations/${automation.id}`, {
			key: user.key,
			body: { steps: [{ id: "mail", type: "email", config: { emailId: copy.emails[0].id } }] },
		});
		assert.equal(stolen.status, 400, "an email step only takes the automation's own emails");
	});

	test("webhooks only reach public https addresses, and notifications go to the owner", async () => {
		assert.equal(await m.automations.sendWebhook({ url: "http://example.com", secret: "s", payload: {} }), "skipped: not an https link");
		assert.match(await m.automations.sendWebhook({ url: "https://127.0.0.1/hook", secret: "s", payload: {} }), /^failed: .*can't reach/);
		assert.match(await m.automations.sendWebhook({ url: "https://localhost/hook", secret: "s", payload: {} }), /^failed: .*can't reach/);

		const user = await customer("flow-notify@example.com");
		const automation = await automationWith(user, {
			trigger: { type: "tag_added", config: { tags: ["ping"] } },
			steps: [{ id: "note", type: "notify", config: { note: "Call them" } }],
		});
		await api(user, "POST", `/automations/${automation.id}/activate`);
		await api(user, "POST", "/contacts", { email: "ping@example.com", tags: ["ping"] });
		await m.automations.runAutomations();
		const notice = platformEmails.findLast(({ subject }) => subject === "Test flow: ping@example.com");
		assert.ok(notice, "the owner got it");
		assert.ok(notice.to.includes("flow-notify@example.com"));
	});
});

describe("pages", () => {
	async function render(user, page, params = {}, searchParams = {}) {
		const element = await as(user, () => page.default({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) }));
		return renderToStaticMarkup(createElement(m.TooltipProvider, null, element));
	}

	test("the list, the templates, the editor, an email and the activity render", async () => {
		const user = await customer("flow-pages@example.com");
		const automation = await automationWith(user, {
			trigger: { type: "tag_added", config: { tags: ["lead"] } },
			steps: [
				{ id: "mail", type: "email", config: { emailId: "EMAIL" } },
				{ id: "cond", type: "condition", config: { match: "all", conditions: [{ field: "tag", op: "has", value: "vip" }] }, yes: [{ id: "wait", type: "delay", config: { amount: 1, unit: "days" } }], no: [] },
			],
		});
		await api(user, "POST", `/automations/${automation.id}/activate`);
		await api(user, "POST", "/contacts", { email: "page@example.com", tags: ["lead"] });
		await m.automations.runAutomations();

		assert.match(await render(user, m.pages.list), /Test flow/);
		assert.match(await render(user, m.pages.list, {}, { tab: "drafts" }), /No drafts/);
		assert.match(await render(user, m.pages.new), /Start from scratch/);
		const editor = await render(user, m.pages.editor, { id: automation.id });
		assert.match(editor, /Joins tag\(s\)/);
		assert.match(editor, /Time delay 1/);
		const email = await render(user, m.pages.email, { id: automation.id, emailId: automation.emails[0].id });
		assert.match(email, /value="Hi \{\{first_name\|friend\}\}"/, "the editor itself starts in the browser");
		const activity = await render(user, m.pages.activity, { id: automation.id });
		assert.match(activity, /page@example\.com/);
	});
});
