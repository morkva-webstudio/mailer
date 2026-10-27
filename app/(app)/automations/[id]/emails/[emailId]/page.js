import { notFound } from "next/navigation";
import FormAutomationEmail from "@/components/FormAutomationEmail";
import { scoped } from "@/lib/account-scope";
import { runDashboardAction } from "@/lib/actions/dashboard";
import { getFieldOptions } from "@/lib/contact-fields";
import { getPostalAddress } from "@/lib/postal-address";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { serialize } from "@/lib/serialize";
import { siteExtensions } from "@/lib/site-extensions";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Automation email" };

export default async function AutomationEmailPage({ params }) {
	const [{ id, emailId }, { account }] = await Promise.all([params, getSelectedNewsletter()]);
	const { output: email, failure } = await runDashboardAction("get_automation_email", { id, emailId });
	if (failure) notFound();
	const { output: automation } = await runDashboardAction("get_automation", { id });
	const stored = await Newsletter.findOne(scoped(account, { _id: automation.newsletterId })).lean();
	if (!stored) notFound();
	// The preview shows the address its emails print.
	const newsletter = { ...stored, postalAddress: getPostalAddress(stored, siteExtensions.defaultPostalAddress) };

	return <FormAutomationEmail automationId={id} email={email} newsletter={serialize(newsletter)} contactFields={getFieldOptions(account)} />;
}
