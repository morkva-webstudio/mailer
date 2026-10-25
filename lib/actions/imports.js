import "server-only";
import * as z from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { actionError } from "@/lib/actions/errors";
import {
	getMailerliteImport,
	previewMailerlite,
	removeMailerliteToken,
	saveMailerliteToken,
	startMailerliteImport,
} from "@/lib/mailerlite-import";

const GROUP = "Imports";

// lib/mailerlite-import.js answers { error } for what the person can fix; which code depends on what went wrong.
function orFail(result, code = "validation_failed") {
	if (result?.error) throw actionError(code, result.error);
	return result;
}

const ImportSchema = z.object({
	status: z.enum(["running", "done", "failed"]),
	step: z.string().nullable(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
	error: z.string().nullable(),
	result: z
		.object({
			subscribers: z.number(),
			created: z.number(),
			existing: z.number(),
			dropped: z.number(),
			groups: z.number(),
			fields: z.array(z.string()),
			skippedFields: z.array(z.string()),
			campaigns: z.object({ created: z.number(), updated: z.number() }).nullable(),
		})
		.nullable(),
});

export const importActions = [
	defineAction({
		name: "connect_mailerlite",
		tryWithoutPlan: true,
		title: "Connect MailerLite",
		group: GROUP,
		description:
			"Saves a MailerLite API token (MailerLite > Integrations > API) to import from. It's checked with MailerLite, kept encrypted and never shown again.",
		http: { method: "POST", path: "/imports/mailerlite/token" },
		openWorld: true,
		idempotent: true,
		rateLimit: { limit: 20, window: "1 h" },
		input: z.object({ token: z.string().trim().min(20).max(2000).describe("The MailerLite API token") }),
		output: z.object({ connected: z.literal(true), tokenHint: z.string().describe("The token's last characters") }),
		handler: async ({ account, input }) => {
			const result = orFail(await saveMailerliteToken(account, input.token));
			return { connected: true, tokenHint: result.tokenHint };
		},
	}),
	defineAction({
		name: "disconnect_mailerlite",
		tryWithoutPlan: true,
		title: "Disconnect MailerLite",
		group: GROUP,
		description: "Forgets the MailerLite API token. What was imported stays.",
		http: { method: "DELETE", path: "/imports/mailerlite/token" },
		idempotent: true,
		whileBlocked: true,
		input: z.object({}),
		output: z.object({ connected: z.literal(false) }),
		handler: async ({ account }) => {
			await removeMailerliteToken(account);
			return { connected: false };
		},
	}),
	defineAction({
		name: "check_mailerlite",
		tryWithoutPlan: true,
		title: "Check MailerLite",
		group: GROUP,
		description: "What an import from the connected MailerLite account would bring: subscribers by status, groups, custom fields and sent campaigns.",
		http: { method: "GET", path: "/imports/mailerlite" },
		readOnly: true,
		openWorld: true,
		input: z.object({}),
		output: z.object({
			subscribers: z.record(z.string(), z.number()).describe("MailerLite's statuses: active, unsubscribed, bounced, junk, unconfirmed"),
			groups: z.array(z.object({ name: z.string(), count: z.number() })),
			fields: z.number().describe("Custom fields besides the name"),
			campaigns: z.number().describe("Sent campaigns"),
		}),
		handler: async ({ account }) => orFail(await previewMailerlite(account), "unavailable"),
	}),
	defineAction({
		name: "import_from_mailerlite",
		tryWithoutPlan: true,
		title: "Import from MailerLite",
		group: GROUP,
		description:
			"Starts an import from the connected MailerLite account into a newsletter, in the background: subscribers with their status (unsubscribed, bounced and spam complaints stay that way), groups as tags, custom fields with values (while there's room), and with campaigns, sent campaigns as past issues that are never sent again. Nobody gets an email. Importing again adds what's new. get_mailerlite_import follows it.",
		http: { method: "POST", path: "/imports/mailerlite" },
		openWorld: true,
		rateLimit: { limit: 10, window: "1 h" },
		input: z.object({
			newsletter: z.string().describe("The newsletter's id, from list_newsletters"),
			campaigns: z.boolean().default(true).describe("Also bring sent campaigns as past issues"),
		}),
		output: z.object({ started: z.literal(true) }),
		handler: async ({ account, user, input }) => {
			const result = await startMailerliteImport({
				account,
				userId: user?._id ?? user?.id ?? account.ownerId,
				newsletterId: input.newsletter,
				withCampaigns: input.campaigns,
			});
			orFail(result, result?.error === "An import is already running" ? "conflict" : "validation_failed");
			return { started: true };
		},
	}),
	defineAction({
		name: "get_mailerlite_import",
		tryWithoutPlan: true,
		title: "Get the MailerLite import",
		group: GROUP,
		description: "How the last import from MailerLite went: running with its step, done with its counts, or failed with why.",
		http: { method: "GET", path: "/imports/mailerlite/status" },
		readOnly: true,
		input: z.object({}),
		output: z.object({ import: ImportSchema.nullable() }),
		handler: async ({ account }) => ({ import: await getMailerliteImport(account) }),
	}),
];
