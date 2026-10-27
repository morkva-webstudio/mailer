"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Eye } from "lucide-react";
import { saveAutomationEmail } from "@/app/(app)/automations/actions";
import DialogPreviewEmail from "@/components/DialogPreviewEmail";
import EditorRich from "@/components/EditorRich";
import RowCampaign from "@/components/RowCampaign";
import StatusSaved from "@/components/StatusSaved";
import { Button } from "@/components/ui/button";
import { toPreviewFrame } from "@/lib/email-preview";
import { renderEmail } from "@/lib/render-email";
import { useAutosave } from "@/lib/use-autosave";
import { useCollapsedSidebar } from "@/lib/use-collapsed-sidebar";

// An automation's email in the campaign editor: its subject, preview text and content, saved as they're written.
export default function FormAutomationEmail({ automationId, email, newsletter, contactFields = [] }) {
	const isHtml = email.format === "html";
	const [initialBody] = useState(email.content);
	const [values, setValues] = useState({ subject: email.subject, previewText: email.previewText, body: email.content });
	const [isPreviewOpen, setIsPreviewOpen] = useState(false);
	const save = useCallback((snapshot) => saveAutomationEmail(automationId, email.id, snapshot), [automationId, email.id]);
	const { isSaving, savedAt, error } = useAutosave(values, save);
	const deferred = useDeferredValue(values);
	useCollapsedSidebar();
	const rendered = useMemo(
		() =>
			renderEmail({
				format: isHtml ? "html" : "rich",
				html: deferred.body,
				subject: deferred.subject,
				previewText: deferred.previewText,
				newsletter,
				language: email.language,
			}),
		[isHtml, deferred, newsletter]
	);
	const previewHtml = useMemo(() => toPreviewFrame(rendered.html), [rendered.html]);
	const update = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
	const updateBody = useCallback((body) => setValues((current) => ({ ...current, body })), []);

	return (
		<div className="mx-auto w-full max-w-2xl">
			<header className="mb-6 flex items-center gap-2 animate-enter">
				<Link
					href={`/automations/${automationId}`}
					aria-label="Back to the automation"
					className="-ml-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
				>
					<ChevronLeft className="size-5" />
				</Link>
				<h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">{email.name || "Email"}</h1>
				{error ? <span className="text-xs text-destructive">{error}</span> : isSaving ? <span className="text-xs text-muted-foreground">Saving…</span> : <StatusSaved savedAt={savedAt} />}
				<Button variant="outline" onClick={() => setIsPreviewOpen(true)}>
					<Eye data-icon="inline-start" />
					Preview
				</Button>
			</header>
			<div className="overflow-hidden rounded-xl bg-card shadow-border animate-enter">
				<div className="divide-y divide-border/60 border-b border-border/60">
					<RowCampaign label="Subject">
						<input
							value={values.subject}
							onChange={update("subject")}
							placeholder="Subject"
							aria-label="Subject"
							maxLength={200}
							className="h-11 w-full min-w-0 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
						/>
					</RowCampaign>
					<RowCampaign label="Preview text">
						<input
							value={values.previewText}
							onChange={update("previewText")}
							placeholder="Shown after the subject in inboxes"
							aria-label="Preview text"
							maxLength={300}
							className="h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						/>
					</RowCampaign>
				</div>
				{isHtml ? (
					<textarea
						value={values.body}
						onChange={update("body")}
						placeholder="<html>"
						spellCheck={false}
						aria-label="Content"
						className="block min-h-[560px] w-full resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 outline-none [field-sizing:content] placeholder:text-muted-foreground"
					/>
				) : (
					<EditorRich content={initialBody} onChange={updateBody} contactFields={contactFields} />
				)}
			</div>
			<DialogPreviewEmail
				isOpen={isPreviewOpen}
				onOpenChange={setIsPreviewOpen}
				html={previewHtml}
				sender={newsletter}
				subject={deferred.subject}
				previewText={deferred.previewText}
				newsletterId={newsletter._id}
				contactFields={contactFields}
			/>
		</div>
	);
}
