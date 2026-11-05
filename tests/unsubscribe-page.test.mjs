import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { activate, as, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

describe("unsubscribe page", () => {
	let app;
	let m;

	before(async () => {
		app = await startTestApp();
		m = {
			page: await import("../lib/unsubscribe-page.js"),
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			route: await import("../app/api/unsubscribe/route.js"),
			token: await import("../lib/unsubscribe.js"),
			stats: await import("../lib/unsubscribe-stats.js"),
			Contact: (await import("../models/Contact.js")).default,
			Newsletter: (await import("../models/Newsletter.js")).default,
		};
	});

	after(() => app?.stop());

	test("lines follow the built-in text until changed, per language, and fill the placeholders", () => {
		const { getUnsubscribeTexts, toUnsubscribePageSettings, mergeUnsubscribePage, fillUnsubscribeText, readUnsubscribeReason } = m.page;
		const settings = toUnsubscribePageSettings({ texts: { uk: { title: "Святі Зорі!", yes: "Так", note: " " } } });
		assert.deepEqual(settings.texts.uk, { title: "Святі Зорі!" }, "the built-in Так and an empty note aren't stored");
		assert.equal(settings.askReason, true);
		assert.equal(getUnsubscribeTexts(settings, "uk").title, "Святі Зорі!");
		assert.equal(getUnsubscribeTexts(settings, "en").title, "Are you sure you want to unsubscribe?");

		const merged = mergeUnsubscribePage(settings, { askReason: false, texts: { en: { no: "Stay" } } });
		assert.deepEqual(merged.texts, { en: { no: "Stay" }, uk: { title: "Святі Зорі!" } }, "a language left out keeps its lines");
		assert.equal(merged.askReason, false);
		assert.deepEqual(mergeUnsubscribePage(merged, { texts: { uk: { title: "" } } }).texts.uk, {}, "empty goes back to built-in");

		assert.deepEqual(fillUnsubscribeText("На {$newsletter} з {$email}.", { newsletter: "MORKVA", email: "a@b.co" }), [
			{ text: "На " },
			{ value: "MORKVA", placeholder: "newsletter" },
			{ text: " з " },
			{ value: "a@b.co", placeholder: "email" },
			{ text: "." },
		]);
		assert.deepEqual(readUnsubscribeReason("spam", "ignored"), { code: "spam" });
		assert.deepEqual(readUnsubscribeReason("other", "  too long \n"), { code: "other", text: "too long" });
		assert.equal(readUnsubscribeReason("nope"), null);
	});

	test("saved from the dashboard; Yes unsubscribes, the answer counts in the stats, a new unsubscribe asks again", async () => {
		const user = await signIn("unsubscribe-page@example.com");
		await activate(user);
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "Unsub news", slug: "unsub-news", postalAddress: "1 Main St, Kyiv" })))
		);
		const newsletterId = url.split("/").at(-1);

		const saved = await as(user, () =>
			m.newsletters.saveUnsubscribePage(newsletterId, {
				askReason: true,
				imageUrl: "https://cdn.example.com/crying.gif",
				texts: { uk: { title: "Святі Зорі! Ви впевнені?", note: "Нам шкода, що ви йдете." }, en: { title: "" } },
			})
		);
		assert.equal(saved.ok, true, saved.error);
		assert.deepEqual(saved.unsubscribePage.customized, { en: [], uk: ["title", "note"] });
		assert.equal(saved.unsubscribePage.texts.uk.yes, "Так");
		assert.equal(saved.unsubscribePage.imageUrl, "https://cdn.example.com/crying.gif");

		const bad = await as(user, () => m.newsletters.saveUnsubscribePage(newsletterId, { imageUrl: "javascript:alert(1)" }));
		assert.ok(bad.error, "a picture that isn't https:// is refused");

		const other = await as(user, () => m.newsletters.saveNewsletter(null, form({ id: newsletterId, section: "general", name: "Unsub news 2", slug: "unsub-news" })));
		assert.equal(other.ok, true, other.error);
		const stored = await m.Newsletter.findOne({ accountId: user.accountId, _id: newsletterId }).lean();
		assert.equal(stored.unsubscribePage.texts.uk.title, "Святі Зорі! Ви впевнені?", "another section's save keeps the page");

		const [leaver, quiet, stayer] = await m.Contact.insertMany(
			["leaver@example.com", "quiet@example.com", "stayer@example.com"].map((email) => ({ accountId: user.accountId, newsletterId, email, status: "active" }))
		);
		function post(contact, fields) {
			const token = m.token.createUnsubscribeToken({ contactId: contact._id, newsletterId });
			return m.route.POST(new Request(`http://localhost:3000/api/unsubscribe?token=${token}`, { method: "POST", body: form(fields) }));
		}
		const status = (response) => new URL(response.headers.get("location")).searchParams.get("status");

		assert.equal(status(await post(stayer, { source: "reason", reason: "spam" })), "thanks");
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, _id: stayer._id }).lean()).unsubscribeReason, undefined, "no reason while subscribed");

		assert.equal(status(await post(leaver, { source: "page" })), "done");
		assert.equal(status(await post(quiet, { source: "page" })), "done");
		assert.equal(status(await post(leaver, { source: "reason", reason: "other", text: "Too many sales" })), "thanks");
		assert.equal(status(await post(quiet, { source: "reason", reason: "made_up" })), "done", "an unknown reason isn't kept");

		await m.Newsletter.updateOne({ accountId: user.accountId, _id: newsletterId }, { $set: { language: "uk" } });
		const stats = await m.stats.getUnsubscribeStats(await m.Newsletter.findOne({ accountId: user.accountId, _id: newsletterId }).lean());
		assert.equal(stats.unsubscribed, 2);
		assert.equal(stats.noReason, 1);
		const otherRow = stats.reasons.find(({ code }) => code === "other");
		assert.deepEqual([otherRow.count, otherRow.share, otherRow.label], [1, 0.5, "Інше"], "labels in the newsletter's language");
		assert.deepEqual(stats.otherAnswers.map(({ text }) => text), ["Too many sales"]);

		await m.Contact.updateOne({ accountId: user.accountId, _id: leaver._id }, { $set: { status: "active" } });
		await post(leaver, { source: "page" });
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, _id: leaver._id }).lean()).unsubscribeReason, undefined, "a new unsubscribe drops the old answer");
	});
});
