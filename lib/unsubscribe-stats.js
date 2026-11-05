import { getNewsletterLanguage } from "./email-language.js";
import { UNSUBSCRIBE_REASONS, getUnsubscribeTexts } from "./unsubscribe-page.js";
import Contact from "../models/Contact.js";

const OTHER_ANSWERS = 50;

// Why a newsletter's unsubscribed contacts left, as they answered on the unsubscribe page. Shares are of everyone
// unsubscribed now, so those who gave no reason (a mail app's one-click button, an import, no answer) count too.
export async function getUnsubscribeStats(newsletter) {
	const filter = { accountId: newsletter.accountId, newsletterId: newsletter._id, status: "unsubscribed" };
	const [unsubscribed, counts, others] = await Promise.all([
		Contact.countDocuments(filter),
		Contact.aggregate([
			{ $match: { ...filter, "unsubscribeReason.code": { $in: UNSUBSCRIBE_REASONS } } },
			{ $group: { _id: "$unsubscribeReason.code", count: { $sum: 1 } } },
		]),
		Contact.find({ ...filter, "unsubscribeReason.code": "other", "unsubscribeReason.text": { $nin: [null, ""] } })
			.sort({ "unsubscribeReason.at": -1 })
			.limit(OTHER_ANSWERS)
			.select({ unsubscribeReason: 1 })
			.lean(),
	]);
	const byCode = Object.fromEntries(counts.map(({ _id, count }) => [_id, count]));
	const texts = getUnsubscribeTexts(newsletter.unsubscribePage, getNewsletterLanguage(newsletter));
	const reasons = UNSUBSCRIBE_REASONS.map((code) => {
		const count = byCode[code] ?? 0;
		return { code, label: texts[`reason_${code}`], count, share: unsubscribed ? count / unsubscribed : 0 };
	});
	const answered = reasons.reduce((sum, { count }) => sum + count, 0);
	return {
		unsubscribed,
		reasons,
		noReason: Math.max(0, unsubscribed - answered),
		otherAnswers: others.map(({ unsubscribeReason }) => ({ text: unsubscribeReason.text, at: unsubscribeReason.at ?? null })),
	};
}
