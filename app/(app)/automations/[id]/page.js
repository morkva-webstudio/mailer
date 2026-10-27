import { notFound } from "next/navigation";
import EditorAutomation from "@/components/EditorAutomation";
import { scoped } from "@/lib/account-scope";
import { runDashboardAction } from "@/lib/actions/dashboard";
import { isSendingEnabled } from "@/lib/config";
import { getFieldOptions } from "@/lib/contact-fields";
import { getNewsletterLanguage } from "@/lib/email-language";
import { listContactTags } from "@/lib/contacts";
import { listLiveSegments } from "@/lib/segment-queries";
import { getSelectedNewsletter, openNewsletter } from "@/lib/selected-newsletter";
import AutomationEmail from "@/models/AutomationEmail";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Automation" };

export default async function AutomationPage({ params }) {
	const [{ id }, view] = await Promise.all([params, getSelectedNewsletter()]);
	const { account } = view;
	const { output: automation, failure } = await runDashboardAction("get_automation", { id });
	if (failure) notFound();
	openNewsletter(view, automation.newsletterId, `/automations/${id}`);

	const [newsletter, tags, segments, contents] = await Promise.all([
		Newsletter.findOne(scoped(account, { _id: automation.newsletterId })).select({ name: 1, slug: 1, fromName: 1, fromEmail: 1, language: 1 }).lean(),
		listContactTags(account, automation.newsletterId),
		listLiveSegments(account, automation.newsletterId),
		AutomationEmail.find(scoped(account, { automationId: automation.id })).select({ html: 1 }).lean(),
	]);
	if (!newsletter) notFound();
	const withContent = new Set(contents.filter(({ html }) => html?.trim()).map(({ _id }) => String(_id)));

	return (
		<EditorAutomation
			automation={{ ...automation, emails: automation.emails.map((email) => ({ ...email, hasContent: withContent.has(email.id) })) }}
			newsletter={{ id: String(newsletter._id), name: newsletter.name, slug: newsletter.slug, language: getNewsletterLanguage(newsletter), fromName: newsletter.fromName ?? "", fromEmail: newsletter.fromEmail ?? "" }}
			fields={getFieldOptions(account)}
			tags={tags.map(({ name }) => name)}
			segments={segments.map(({ _id, name }) => ({ id: String(_id), name }))}
			isSendingEnabled={isSendingEnabled()}
		/>
	);
}
