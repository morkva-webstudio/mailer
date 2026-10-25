"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
	checkMailerlite,
	connectMailerlite,
	disconnectMailerlite,
	getMailerliteImport,
	importFromMailerlite,
} from "@/app/(app)/api-keys/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatRelative } from "@/lib/format";
import { toast } from "@/lib/toast";

const POLL_MS = 2000;
const STATUS_LABELS = { active: "Active", unsubscribed: "Unsubscribed", bounced: "Bounced", junk: "Spam complaints", unconfirmed: "Unconfirmed" };

// Brings subscribers, groups (as tags), fields and past campaigns over from MailerLite (lib/mailerlite-import.js).
export default function CardMailerlite({ isConnected, tokenHint, newsletters, lastImport: initialImport }) {
	return (
		<section style={{ "--stagger": 2 }} className="rounded-xl bg-card p-4 shadow-border animate-enter sm:p-5">
			<div className="max-w-lg">
				<h2 className="font-semibold tracking-tight">Import from MailerLite</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Subscribers with their status, groups as tags, custom fields and sent campaigns. Importing again adds what&apos;s new and
					keeps unsubscribes; nobody gets an email.
				</p>
			</div>
			{isConnected ? (
				<ImportMailerlite tokenHint={tokenHint} newsletters={newsletters} initialImport={initialImport} />
			) : (
				<FormConnect />
			)}
		</section>
	);
}

function FormConnect() {
	const [state, formAction, isPending] = useActionState(connectMailerlite, null);

	return (
		<form action={formAction} className="mt-4 flex max-w-lg flex-col gap-2 sm:flex-row">
			<Input name="token" type="password" autoComplete="off" placeholder="MailerLite API token" required aria-label="MailerLite API token" />
			<Button type="submit" disabled={isPending} className="shrink-0">
				{isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
				Connect
			</Button>
			{state?.error && <p className="text-sm text-destructive sm:basis-full">{state.error}</p>}
		</form>
	);
}

function ImportMailerlite({ tokenHint, newsletters, initialImport }) {
	const router = useRouter();
	const [preview, setPreview] = useState(null);
	const [newsletterId, setNewsletterId] = useState(newsletters[0]?.id ?? "");
	const [withCampaigns, setWithCampaigns] = useState(true);
	const [lastImport, setLastImport] = useState(initialImport);
	const [isPending, startTransition] = useTransition();
	const isRunning = lastImport?.status === "running";

	useEffect(() => {
		if (!isRunning) return;
		const timer = setInterval(async () => setLastImport(await getMailerliteImport()), POLL_MS);
		return () => clearInterval(timer);
	}, [isRunning]);

	function check() {
		startTransition(async () => {
			const result = await checkMailerlite();
			if (result.error) toast.error(result.error);
			else setPreview(result);
		});
	}

	function start() {
		startTransition(async () => {
			const result = await importFromMailerlite({ newsletterId, withCampaigns });
			if (result.error) return void toast.error(result.error);
			setLastImport(await getMailerliteImport());
		});
	}

	function disconnect() {
		startTransition(async () => {
			await disconnectMailerlite();
			router.refresh();
		});
	}

	return (
		<div className="mt-4 flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
				<span>
					Connected <span className="font-mono text-xs text-muted-foreground">…{tokenHint}</span>
				</span>
				<button type="button" onClick={disconnect} disabled={isPending || isRunning} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
					Disconnect
				</button>
			</div>

			{preview ? <Preview preview={preview} /> : null}

			{newsletters.length === 0 ? (
				<p className="text-sm text-muted-foreground">Create a newsletter first: contacts go into one.</p>
			) : (
				<div className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center gap-3">
						<Select value={newsletterId} onValueChange={setNewsletterId} disabled={isRunning}>
							<SelectTrigger className="w-56" aria-label="Newsletter">
								<SelectValue placeholder="Newsletter" />
							</SelectTrigger>
							<SelectContent>
								{newsletters.map((newsletter) => (
									<SelectItem key={newsletter.id} value={newsletter.id}>
										{newsletter.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<label className="flex items-center gap-2 text-sm">
							<Switch checked={withCampaigns} onCheckedChange={setWithCampaigns} disabled={isRunning} />
							Sent campaigns as past issues
						</label>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={check} disabled={isPending || isRunning}>
							Check
						</Button>
						<Button onClick={start} disabled={isPending || isRunning || !newsletterId}>
							{(isRunning || isPending) && <Loader2 data-icon="inline-start" className="animate-spin" />}
							{isRunning ? "Importing…" : "Import"}
						</Button>
					</div>
				</div>
			)}

			{lastImport ? <ImportStatus lastImport={lastImport} /> : null}
		</div>
	);
}

function Preview({ preview }) {
	return (
		<dl className="grid max-w-lg grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-muted/40 p-3 text-sm">
			{Object.entries(preview.subscribers).map(([status, count]) => (
				<Row key={status} label={STATUS_LABELS[status] ?? status} value={count} />
			))}
			<Row label="Groups" value={preview.groups.length} />
			<Row label="Custom fields" value={preview.fields} />
			<Row label="Sent campaigns" value={preview.campaigns} />
		</dl>
	);
}

function Row({ label, value }) {
	return (
		<>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="text-right tabular-nums">{Number(value).toLocaleString("en-US")}</dd>
		</>
	);
}

function ImportStatus({ lastImport }) {
	if (lastImport.status === "running") return <p className="text-sm text-muted-foreground">{lastImport.step}…</p>;
	if (lastImport.status === "failed") return <p className="text-sm text-destructive">The import stopped: {lastImport.error}</p>;
	const result = lastImport.result ?? {};
	return (
		<div className="max-w-lg text-sm">
			<p>
				Imported {formatRelative(lastImport.finishedAt)}: {result.subscribers} subscribers ({result.created} new, {result.existing} already here
				{result.dropped ? `, ${result.dropped} skipped by the checks` : ""}), {result.groups} groups as tags, {result.fields?.length ?? 0} fields
				{result.campaigns ? `, ${result.campaigns.created + result.campaigns.updated} campaigns` : ""}.
			</p>
			{result.skippedFields?.length > 0 && (
				<p className="mt-1 text-muted-foreground">No room for these fields (20 at most): {result.skippedFields.join(", ")}.</p>
			)}
		</div>
	);
}
