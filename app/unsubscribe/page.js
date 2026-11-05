import CardUnsubscribe from "@/components/CardUnsubscribe";
import StyleTheme from "@/components/StyleTheme";
import { connectDb } from "@/lib/db";
import { getNewsletterLanguage } from "@/lib/email-language";
import { findNewsletterAnywhere } from "@/lib/public-newsletters";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { getUnsubscribeTexts } from "@/lib/unsubscribe-page";
import Contact from "@/models/Contact";

// The URL carries the unsubscribe token: keep it out of search results and referrer headers.
export const metadata = {
	title: "Unsubscribe",
	robots: { index: false, follow: false },
	referrer: "no-referrer",
};

const SUBSCRIBED_STATUSES = ["active", "dormant"];

// The page an email's unsubscribe link opens, in the newsletter's emails' language with its own lines
// (lib/unsubscribe-page.js): Yes unsubscribes, No keeps them; once unsubscribed, it asks why.
export default async function UnsubscribePage({ searchParams }) {
	const { token, status } = await searchParams;
	const validToken = typeof token === "string" ? token : null;
	const reference = verifyUnsubscribeToken(validToken);
	const subscription = reference ? await getSubscription(reference) : null;
	const step = getStep({ reference, status, subscription });
	const texts = getUnsubscribeTexts(subscription?.unsubscribePage, subscription?.language);
	const values = { newsletter: subscription?.newsletterName || texts.thisNewsletter, email: subscription?.email };

	return (
		<main lang={subscription?.language ?? "en"} className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
			<StyleTheme theme={subscription?.theme} />
			<CardUnsubscribe
				step={step}
				texts={texts}
				values={values}
				imageUrl={subscription?.unsubscribePage?.imageUrl}
				askReason={subscription?.unsubscribePage?.askReason !== false && !subscription?.hasReason}
				token={reference ? validToken : null}
			/>
		</main>
	);
}

async function getSubscription({ contactId, newsletterId }) {
	try {
		await connectDb();
		const newsletter = await findNewsletterAnywhere({ _id: newsletterId });
		const contact =
			newsletter &&
			(await Contact.findOne({ accountId: newsletter.accountId, _id: contactId, newsletterId })
				.select({ status: 1, email: 1, "unsubscribeReason.code": 1 })
				.lean());
		return {
			newsletterName: newsletter?.name,
			theme: newsletter?.theme,
			language: getNewsletterLanguage(newsletter),
			unsubscribePage: newsletter?.unsubscribePage,
			email: contact?.email,
			hasReason: Boolean(contact?.unsubscribeReason?.code),
			isSubscribed: !contact || SUBSCRIBED_STATUSES.includes(contact.status),
		};
	} catch (error) {
		console.error("[unsubscribe] Could not load the subscription:", error.message);
		return { isSubscribed: true };
	}
}

// Someone already unsubscribed sees done (and the question, until they answer); No only shows while subscribed.
function getStep({ reference, status, subscription }) {
	if (!reference) return "invalid";
	if (status === "error") return "error";
	if (subscription?.isSubscribed === false) return status === "thanks" ? "thanks" : "done";
	return status === "stay" ? "stay" : "confirm";
}
