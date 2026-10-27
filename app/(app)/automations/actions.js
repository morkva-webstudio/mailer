"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runDashboardAction, toFormError } from "@/lib/actions/dashboard";

function refresh(id) {
	revalidatePath("/automations");
	if (id) revalidatePath(`/automations/${id}`);
}

// The Create automation dialog: a draft with its name, then its editor.
export async function createAutomation(newsletterId, name) {
	const { output, failure } = await runDashboardAction("create_automation", {
		newsletter: String(newsletterId ?? ""),
		name: String(name ?? "").slice(0, 100),
	});
	if (failure) return toFormError(failure);
	revalidatePath("/automations");
	redirect(`/automations/${output.id}`);
}

// The editor saves the whole automation as it is: its name, trigger, steps and settings.
export async function saveAutomation(id, values) {
	const { output, failure } = await runDashboardAction("update_automation", {
		id: String(id),
		...(values?.name !== undefined && { name: String(values.name).slice(0, 100) }),
		...(values?.trigger && { trigger: values.trigger }),
		...(values?.steps && { steps: values.steps }),
		...(values?.reenter !== undefined && { reenter: Boolean(values.reenter) }),
	});
	if (failure) return toFormError(failure);
	refresh(id);
	return { ok: true, incomplete: output.incomplete, waitingByStep: output.waitingByStep };
}

export async function setAutomationActive(id, isActive) {
	const input = { id: String(id) };
	const { output, failure } = isActive ? await runDashboardAction("activate_automation", input) : await runDashboardAction("pause_automation", input);
	if (failure) return toFormError(failure);
	refresh(id);
	return { ok: true, status: output.status };
}

export async function duplicateAutomation(id) {
	const { output, failure } = await runDashboardAction("duplicate_automation", { id: String(id) });
	if (failure) return toFormError(failure);
	revalidatePath("/automations");
	redirect(`/automations/${output.id}`);
}

export async function deleteAutomation(id, { stay = false } = {}) {
	const { failure } = await runDashboardAction("delete_automation", { id: String(id) });
	if (failure) return toFormError(failure);
	revalidatePath("/automations");
	if (!stay) redirect("/automations");
	return { ok: true };
}

// A Send email step's email, made when the step is added.
export async function createAutomationEmail(id) {
	const { output, failure } = await runDashboardAction("create_automation_email", { id: String(id) });
	if (failure) return toFormError(failure);
	const { id: emailId, name, subject, previewText, language, utm } = output;
	return { ok: true, email: { id: emailId, name, subject, previewText, language, utm } };
}

export async function saveAutomationEmail(id, emailId, values) {
	const { failure } = await runDashboardAction("update_automation_email", {
		id: String(id),
		emailId: String(emailId),
		...(values?.name !== undefined && { name: String(values.name).slice(0, 100) }),
		...(values?.subject !== undefined && { subject: String(values.subject).slice(0, 200) }),
		...(values?.previewText !== undefined && { previewText: String(values.previewText).slice(0, 300) }),
		...(values?.body !== undefined && { content: String(values.body) }),
		...(values?.language !== undefined && { language: String(values.language) }),
		...(values?.utm !== undefined && { utm: values.utm }),
	});
	if (failure) return toFormError(failure);
	refresh(id);
	return { ok: true };
}

export async function sendAutomationTest(id) {
	const { output, failure } = await runDashboardAction("send_automation_test", { id: String(id) });
	if (failure) return toFormError(failure);
	return { ok: true, to: output.to, sent: output.sent };
}

// Add subscribers: how many a tag or segment picks, then letting them in.
export async function addAutomationContacts(id, { tag, segment, countOnly }) {
	const { output, failure } = await runDashboardAction("add_automation_contacts", {
		id: String(id),
		...(tag && { tag: String(tag) }),
		...(segment && { segment: String(segment) }),
		countOnly: Boolean(countOnly),
	});
	if (failure) return toFormError(failure);
	if (!countOnly) refresh(id);
	return { ok: true, contacts: output.contacts, added: output.added };
}
