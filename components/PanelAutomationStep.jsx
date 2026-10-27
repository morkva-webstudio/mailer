"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import BadgeSoon from "@/components/BadgeSoon";
import ButtonCopy from "@/components/ButtonCopy";
import { NEW_CONDITION, RowCondition, ToggleMatch, withKey } from "@/components/DialogSegment";
import PickerTags from "@/components/PickerTags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DELAY_UNITS, MAX_ANNIVERSARY_OFFSET, MAX_DELAY, MAX_NOTE_LENGTH, MAX_URL_LENGTH, getStepInfo, getTriggerInfo } from "@/lib/automation-steps";
import { EMAIL_LANGUAGE_OPTIONS } from "@/lib/email-language";
import { formatNumber } from "@/lib/format";
import { slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";

// The settings of the step picked on the canvas, in the panel on the right: changed here, kept on Save.
// step: the trigger ({ type, config }) or a step; email: the Send email step's email; onSave(config, email).
export default function PanelAutomationStep({ automationId, step, isTrigger, label, email, newsletter, fields, tags, waiting, webhookSecret, notifyRecipients, onSave, onClose, onDesignEmail }) {
	const [config, setConfig] = useState(() => withConditionKeys(step.config ?? {}));
	const [emailDraft, setEmailDraft] = useState(() => ({
		name: email?.name ?? "",
		subject: email?.subject ?? "",
		previewText: email?.previewText ?? "",
		language: email?.language ?? "",
		utm: email?.utm ?? { enabled: false, source: "", medium: "", campaign: "" },
	}));
	const setUtm = (change) => setEmailDraft((current) => ({ ...current, utm: { ...current.utm, ...change } }));
	const info = isTrigger ? getTriggerInfo(step.type) : getStepInfo(step.type);
	const set = (change) => setConfig((current) => ({ ...current, ...change }));
	const dateFields = fields.filter(({ type }) => type === "date");

	function save() {
		onSave(withoutConditionKeys(config), step.type === "email" ? emailDraft : null);
	}

	return (
		<aside className="flex w-full flex-col border-l border-border/60 bg-background sm:w-96" aria-label={`${label} settings`}>
			<header className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
				<h2 className="truncate text-lg font-semibold">{label}</h2>
				<Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
					<span aria-hidden>×</span>
				</Button>
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
				{!info?.enabled && <p className="text-sm text-muted-foreground">{"This step isn't available yet."}</p>}

				{step.type === "tag_added" && (
					<>
						<Field label="Tags" hint="A contact who gets one of these tags goes in.">
							<PickerTags newsletterId={newsletter.id} tags={tags} value={config.tags ?? []} onChange={(value) => set({ tags: value })} placeholder="Select tag(s)" />
						</Field>
						<Field label="Exclude" hint="Contacts with one of these tags never go in.">
							<PickerTags newsletterId={newsletter.id} tags={tags} value={config.exclude ?? []} onChange={(value) => set({ exclude: value })} placeholder="Add a tag" label="Excluded tags" />
						</Field>
						<Check checked={Boolean(config.exitOnLeave)} onChange={(value) => set({ exitOnLeave: value })}>
							Exit contacts from the automation when they leave all trigger tags or join an excluded tag
						</Check>
					</>
				)}

				{step.type === "link_clicked" && (
					<>
						<Field label="Link" hint="A click on it in any email of this newsletter, a campaign or an automation's.">
							<Input value={config.url ?? ""} onChange={(event) => set({ url: event.target.value })} placeholder="https://example.com/page" maxLength={MAX_URL_LENGTH} inputMode="url" />
						</Field>
						<Field label="Match">
							<Choice
								value={config.match ?? "exact"}
								onChange={(match) => set({ match })}
								options={[
									{ value: "exact", label: "This link" },
									{ value: "prefix", label: "Any link that starts with it" },
								]}
							/>
						</Field>
					</>
				)}

				{step.type === "field_updated" && (
					<Field label="Field" hint="When a contact's value changes, on the dashboard or through the API (an integration's sync too). CSV imports don't count.">
						<PickField value={config.field} fields={fields} onChange={(field) => set({ field })} />
					</Field>
				)}

				{step.type === "anniversary" && (
					<>
						<Field label="Date field" hint={dateFields.length === 0 ? "Add a date field to contacts first." : "Every year on its day and month."}>
							<PickField value={config.field} fields={dateFields} onChange={(field) => set({ field })} />
						</Field>
						<Field label="When">
							<div className="flex items-center gap-2">
								<Input
									type="number"
									min={0}
									max={MAX_ANNIVERSARY_OFFSET}
									value={Math.abs(config.offsetDays ?? 0)}
									onChange={(event) => set({ offsetDays: Math.sign(config.offsetDays || 1) * Math.abs(Number(event.target.value) || 0) })}
									className="w-20"
									aria-label="Days"
								/>
								<Choice
									value={(config.offsetDays ?? 0) < 0 ? "before" : "after"}
									onChange={(side) => set({ offsetDays: (side === "before" ? -1 : 1) * Math.abs(config.offsetDays ?? 0) })}
									options={[
										{ value: "before", label: "days before" },
										{ value: "after", label: "days after" },
									]}
								/>
							</div>
						</Field>
						<Field label="At" hint="In your account's timezone.">
							<Input type="time" value={config.time ?? "09:00"} onChange={(event) => set({ time: event.target.value })} className="w-32" />
						</Field>
					</>
				)}

				{step.type === "exact_date" && (
					<>
						<Field label="Date and time" hint="Once: every active contact goes in then.">
							<Input type="datetime-local" value={toLocalInput(config.at)} onChange={(event) => set({ at: fromLocalInput(event.target.value) })} />
						</Field>
						<Field label="Only contacts with these tags" hint="Leave empty for every active contact.">
							<PickerTags newsletterId={newsletter.id} tags={tags} value={config.tags ?? []} onChange={(value) => set({ tags: value })} placeholder="Add a tag" />
						</Field>
					</>
				)}

				{step.type === "delay" && (
					<Field label="Wait">
						<div className="flex items-center gap-2">
							<Input
								type="number"
								min={1}
								max={MAX_DELAY[config.unit ?? "days"]}
								value={config.amount ?? ""}
								onChange={(event) => set({ amount: Number(event.target.value) || 0 })}
								className="w-20"
								aria-label="How long"
							/>
							<Select value={config.unit ?? "days"} onValueChange={(unit) => set({ unit })}>
								<SelectTrigger className="flex-1" aria-label="Unit">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{DELAY_UNITS.map((unit) => (
										<SelectItem key={unit} value={unit}>
											{unit.replace("s", "(s)")}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</Field>
				)}

				{step.type === "condition" && (
					<Field label="Contacts who meet" hint="Go down Yes; the others down No.">
						{(config.conditions ?? []).length > 1 && <ToggleMatch value={config.match ?? "all"} onChange={(match) => set({ match })} />}
						<ul className="flex flex-col gap-1.5">
							{(config.conditions ?? []).map((condition) => (
								<RowCondition
									key={condition.key}
									condition={condition}
									fields={fields}
									tags={tags}
									onChange={(change) => set({ conditions: config.conditions.map((item) => (item.key === condition.key ? change(item) : item)) })}
									onRemove={() => set({ conditions: config.conditions.filter((item) => item.key !== condition.key) })}
								/>
							))}
						</ul>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="self-start"
							disabled={(config.conditions ?? []).length >= 10}
							onClick={() => set({ conditions: [...(config.conditions ?? []), withKey(NEW_CONDITION)] })}
						>
							<Plus data-icon="inline-start" />
							Add condition
						</Button>
					</Field>
				)}

				{step.type === "email" && (
					<>
						<Field label="Email content">
							<Button type="button" onClick={() => onDesignEmail(emailDraft)} disabled={!email}>
								Design email
							</Button>
						</Field>
						<Field label="Email name">
							<Input value={emailDraft.name} onChange={(event) => setEmailDraft({ ...emailDraft, name: event.target.value })} placeholder="Name" maxLength={100} />
						</Field>
						<Field
							label="Subject"
							extra={
								<span className="flex gap-1.5">
									<Button type="button" variant="outline" size="xs" disabled>
										Suggest <BadgeSoon />
									</Button>
									<Button type="button" variant="outline" size="xs" disabled>
										Insert personalization <ChevronDown />
									</Button>
								</span>
							}
						>
							<Input value={emailDraft.subject} onChange={(event) => setEmailDraft({ ...emailDraft, subject: event.target.value })} placeholder="Email subject" maxLength={200} />
						</Field>
						<Field label="Preview text">
							<Input value={emailDraft.previewText} onChange={(event) => setEmailDraft({ ...emailDraft, previewText: event.target.value })} maxLength={300} />
						</Field>
						<Field label="Who is it from?" hint="The newsletter's sender, in its settings.">
							<Input value={newsletter.fromName || newsletter.name || ""} readOnly disabled />
						</Field>
						<Field label="Sender email">
							<Input value={newsletter.fromEmail ?? ""} readOnly disabled />
						</Field>
						<Check checked={false} disabled>
							Use different Reply-to email <BadgeSoon />
						</Check>
						<Field label="Opens tracking">
							<Check checked disabled>
								Track opens with an invisible beacon embedded in your email.
							</Check>
						</Field>
						<Field label="UTM tags">
							<Check
								checked={emailDraft.utm.enabled}
								onChange={(enabled) =>
									setUtm({
										enabled,
										// Filled in the first time, from the newsletter and the email.
										...(enabled && !emailDraft.utm.source && !emailDraft.utm.medium && !emailDraft.utm.campaign
											? { source: newsletter.slug ?? "", medium: "email", campaign: slugify(emailDraft.name || emailDraft.subject, 80) }
											: {}),
									})
								}
							>
								Add parameters to your URLs to track newsletter traffic on web analytics platforms.
							</Check>
							{emailDraft.utm.enabled && (
								<div className="grid gap-2 pl-6.5">
									{[
										["source", "utm_source"],
										["medium", "utm_medium"],
										["campaign", "utm_campaign"],
									].map(([key, name]) => (
										<label key={key} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-sm">
											<span className="font-mono text-xs text-muted-foreground">{name}</span>
											<Input value={emailDraft.utm[key]} onChange={(event) => setUtm({ [key]: event.target.value })} maxLength={100} />
										</label>
									))}
									<p className="text-xs text-muted-foreground">Links that already have utm_ parameters keep theirs.</p>
								</div>
							)}
						</Field>
						<Field label="Language" hint="The words the email adds: its footer and Read online link.">
							<Select value={emailDraft.language || "newsletter"} onValueChange={(value) => setEmailDraft({ ...emailDraft, language: value === "newsletter" ? "" : value })}>
								<SelectTrigger aria-label="Language">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="newsletter">
										Newsletter&apos;s ({EMAIL_LANGUAGE_OPTIONS.find(({ id }) => id === newsletter.language)?.label ?? "English"})
									</SelectItem>
									{EMAIL_LANGUAGE_OPTIONS.map(({ id, label }) => (
										<SelectItem key={id} value={id}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</>
				)}

				{["tags_copy", "tags_move", "tags_remove"].includes(step.type) && (
					<Field
						label="Tags"
						hint={
							step.type === "tags_copy"
								? "Added to the contact; its other tags stay."
								: step.type === "tags_move"
									? "Added to the contact, and the trigger's tags taken off."
									: "Taken off the contact."
						}
					>
						<PickerTags newsletterId={newsletter.id} tags={tags} value={config.tags ?? []} onChange={(value) => set({ tags: value })} placeholder="Select tag(s)" />
					</Field>
				)}

				{step.type === "field_update" && (
					<>
						<Field label="Field">
							<PickField value={config.field} fields={fields} onChange={(field) => set({ field, value: null })} />
						</Field>
						<Field label="New value" hint="Leave empty to clear it.">
							<Input
								type={fields.find(({ key }) => key === config.field)?.type === "date" ? "date" : fields.find(({ key }) => key === config.field)?.type === "number" ? "number" : "text"}
								value={config.value ?? ""}
								onChange={(event) => set({ value: event.target.value })}
								maxLength={500}
							/>
						</Field>
					</>
				)}

				{step.type === "unsubscribe" && <p className="text-sm text-muted-foreground">The contact is unsubscribed from the newsletter here: no more emails from it.</p>}

				{step.type === "webhook" && (
					<>
						<Field label="URL" hint="An https address. Mailer POSTs the contact (email, name, tags, fields) and the automation as JSON.">
							<Input value={config.url ?? ""} onChange={(event) => set({ url: event.target.value })} placeholder="https://example.com/hooks/mailer" maxLength={MAX_URL_LENGTH} inputMode="url" />
						</Field>
						{webhookSecret && (
							<Field label="Signing secret" hint="X-Mailer-Signature is sha256= and the HMAC-SHA256 of the body with it.">
								<div className="flex items-center gap-1 rounded-lg bg-muted py-1 pr-1 pl-3">
									<code className="min-w-0 flex-1 truncate font-mono text-[13px]">{webhookSecret}</code>
									<ButtonCopy value={webhookSecret} label="Copy secret" />
								</div>
							</Field>
						)}
					</>
				)}

				{step.type === "notify" && (
					<Field label="Note" hint={`Goes to ${notifyRecipients.join(", ")}, with the contact's address.`}>
						<Textarea value={config.note ?? ""} onChange={(event) => set({ note: event.target.value })} maxLength={MAX_NOTE_LENGTH} rows={4} placeholder="Call them about the order" />
					</Field>
				)}

				{!isTrigger && (
					<div className="flex flex-col gap-2 border-t border-border/60 pt-4">
						<p className="flex items-center gap-2 text-sm font-medium">
							In progress <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums">{formatNumber(waiting ?? 0)}</span>
						</p>
						<p className="text-sm text-muted-foreground">Contacts waiting at this step.</p>
						<Button variant="secondary" asChild>
							<Link href={`/automations/${automationId}/activity?status=waiting`}>See more details</Link>
						</Button>
					</div>
				)}
			</div>
			<footer className="flex justify-end gap-2 border-t border-border/60 p-4">
				<Button variant="ghost" onClick={onClose}>
					Cancel
				</Button>
				<Button onClick={save} disabled={!info?.enabled}>
					Save
				</Button>
			</footer>
		</aside>
	);
}

function Field({ label, hint, extra, children }) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium">{label}</span>
				{extra}
			</div>
			{children}
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}

function Check({ checked, disabled, onChange, children }) {
	return (
		<label className={cn("flex items-start gap-2.5 text-sm", disabled && "text-muted-foreground")}>
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange?.(event.target.checked)}
				className="mt-0.5 size-4 shrink-0 accent-foreground"
			/>
			<span className="flex flex-wrap items-center gap-1.5">{children}</span>
		</label>
	);
}

function Choice({ value, onChange, options }) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger className="flex-1">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function PickField({ value, fields, onChange }) {
	if (fields.length === 0) return <p className="text-sm text-muted-foreground">No fields yet: add them on the Contacts page.</p>;
	return (
		<Select value={value || undefined} onValueChange={onChange}>
			<SelectTrigger aria-label="Field">
				<SelectValue placeholder="Pick a field" />
			</SelectTrigger>
			<SelectContent>
				{fields.map(({ key, label }) => (
					<SelectItem key={key} value={key}>
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function withConditionKeys(config) {
	return Array.isArray(config.conditions) ? { ...config, conditions: config.conditions.map((condition) => withKey(condition)) } : config;
}

function withoutConditionKeys(config) {
	return Array.isArray(config.conditions) ? { ...config, conditions: config.conditions.map(({ key: _, ...condition }) => condition) } : config;
}

// datetime-local works in the browser's time; the automation keeps an instant.
function toLocalInput(iso) {
	if (!iso) return "";
	const date = new Date(iso);
	return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fromLocalInput(value) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
