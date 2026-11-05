import { redirect } from "next/navigation";
import FormUnsubscribePage from "@/components/FormUnsubscribePage";
import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import { scoped } from "@/lib/account-scope";
import { getNewsletterLanguage } from "@/lib/email-language";
import { SETTINGS_PATH, UNSUBSCRIBE_SECTION } from "@/lib/newsletter-sections";
import { ADD_NEWSLETTER_PATH } from "@/lib/newsletters";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { serialize } from "@/lib/serialize";
import { toUnsubscribePageSettings } from "@/lib/unsubscribe-page";
import { getUnsubscribeStats } from "@/lib/unsubscribe-stats";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: UNSUBSCRIBE_SECTION.label };

// The page the unsubscribe link in the open newsletter's emails opens, to preview and change, and why people left.
// ?tab=stats opens the reasons.
export default async function UnsubscribeSettingsPage({ searchParams }) {
	const [{ account, selected }, { tab }] = await Promise.all([getSelectedNewsletter(), searchParams]);
	if (!selected) redirect(ADD_NEWSLETTER_PATH);
	const newsletter = await Newsletter.findOne(scoped(account, { _id: selected._id }))
		.select({ accountId: 1, name: 1, language: 1, unsubscribePage: 1 })
		.lean();
	const stats = await getUnsubscribeStats(newsletter);

	return (
		<LayoutNarrow>
			<HeaderPage title={UNSUBSCRIBE_SECTION.label} backHref={SETTINGS_PATH} />
			<FormUnsubscribePage
				key={String(newsletter._id)}
				newsletterId={String(newsletter._id)}
				newsletterName={newsletter.name}
				language={getNewsletterLanguage(newsletter)}
				settings={toUnsubscribePageSettings(newsletter.unsubscribePage)}
				stats={serialize(stats)}
				defaultTab={tab === "stats" ? "stats" : "form"}
			/>
		</LayoutNarrow>
	);
}
