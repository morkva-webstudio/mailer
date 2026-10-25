"use server";

import { revalidatePath } from "next/cache";
import { runDashboardAction, toFormError } from "@/lib/actions/dashboard";

export async function createApiKey(_state, formData) {
	const { output, failure } = await runDashboardAction("create_api_key", {
		name: String(formData.get("name") ?? "").slice(0, 60),
		level: formData.get("level") === "signups" ? "signups" : "full",
	});
	if (failure) return toFormError(failure);
	revalidatePath("/api-keys");
	return { key: output.key, level: output.apiKey.level };
}

export async function revokeApiKey(id) {
	const { failure } = await runDashboardAction("revoke_api_key", { id: String(id) });
	revalidatePath("/api-keys");
	return failure ? toFormError(failure) : { ok: true };
}

export async function revokeConnectedApp(id) {
	const { failure } = await runDashboardAction("revoke_connected_app", { id: String(id) });
	revalidatePath("/api-keys");
	return failure ? toFormError(failure) : { ok: true };
}

// MailerLite (lib/actions/imports.js): the token, what an import would bring, the import, and how it goes.
export async function connectMailerlite(_state, formData) {
	const { failure } = await runDashboardAction("connect_mailerlite", { token: String(formData.get("token") ?? "") });
	if (failure) return toFormError(failure);
	revalidatePath("/api-keys");
	return { ok: true };
}

export async function disconnectMailerlite() {
	const { failure } = await runDashboardAction("disconnect_mailerlite", {});
	revalidatePath("/api-keys");
	return failure ? toFormError(failure) : { ok: true };
}

export async function checkMailerlite() {
	const { output, failure } = await runDashboardAction("check_mailerlite", {});
	return failure ? toFormError(failure) : output;
}

export async function importFromMailerlite({ newsletterId, withCampaigns } = {}) {
	const { failure } = await runDashboardAction("import_from_mailerlite", { newsletter: String(newsletterId ?? ""), campaigns: withCampaigns === true });
	return failure ? toFormError(failure) : { ok: true };
}

export async function getMailerliteImport() {
	const { output, failure } = await runDashboardAction("get_mailerlite_import", {});
	return failure ? null : output.import;
}
