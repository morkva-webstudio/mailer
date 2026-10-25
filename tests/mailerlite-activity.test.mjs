import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { activate, as, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

describe("MailerLite activity", () => {
	let app;
	let m;

	before(async () => {
		app = await startTestApp();
		m = {
			mailerlite: await import("../lib/mailerlite-import.js"),
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			Contact: (await import("../models/Contact.js")).default,
		};
	});

	after(() => app?.stop());

	test("who opened and clicked past campaigns gives contacts their last open and click, never moving one back", async () => {
		const user = await signIn("mailerlite-activity@example.com");
		await activate(user);
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "ML news", slug: "ml-news", postalAddress: "1 Main St, Paris" })))
		);
		const newsletterId = url.split("/").at(-1);
		const later = new Date("2026-10-20T00:00:00Z");
		const contact = (email, fields = {}) => ({ accountId: user.accountId, newsletterId, email, status: "active", ...fields });
		await m.Contact.insertMany([contact("opener@example.com"), contact("clicker@example.com"), contact("recent@example.com", { lastOpenAt: later }), contact("quiet@example.com")]);

		const result = await m.mailerlite.setLastActivity({
			account: { _id: user.accountId },
			newsletterId,
			lastOpens: new Map([
				["opener@example.com", new Date("2026-09-23T00:00:00Z")],
				["recent@example.com", new Date("2026-09-23T00:00:00Z")],
				["gone@example.com", new Date("2026-09-23T00:00:00Z")],
			]),
			lastClicks: new Map([["clicker@example.com", new Date("2026-10-01T00:00:00Z")]]),
		});
		assert.deepEqual(result, { opened: 4, clicked: 1 });

		const byEmail = Object.fromEntries((await m.Contact.find({ accountId: user.accountId, newsletterId }).lean()).map((one) => [one.email, one]));
		assert.equal(byEmail["opener@example.com"].lastOpenAt.toISOString(), "2026-09-23T00:00:00.000Z");
		assert.equal(byEmail["opener@example.com"].lastClickAt, undefined);
		assert.equal(byEmail["clicker@example.com"].lastOpenAt.toISOString(), "2026-10-01T00:00:00.000Z", "a click counts as an open");
		assert.equal(byEmail["clicker@example.com"].lastClickAt.toISOString(), "2026-10-01T00:00:00.000Z");
		assert.equal(byEmail["recent@example.com"].lastOpenAt.toISOString(), later.toISOString(), "a later open stays");
		assert.equal(byEmail["quiet@example.com"].lastOpenAt, undefined);
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, newsletterId }), 4, "nobody is added");
	});
});
