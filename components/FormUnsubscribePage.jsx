"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { saveUnsubscribePage } from "@/app/(app)/newsletters/actions";
import BarSave from "@/components/BarSave";
import CardUnsubscribe from "@/components/CardUnsubscribe";
import { Segmented } from "@/components/FieldsTheme";
import { Field, Section } from "@/components/FormNewsletter";
import InputImage from "@/components/InputImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EMAIL_LANGUAGE_OPTIONS } from "@/lib/email-language";
import { formatNumber } from "@/lib/format";
import { getSectionPath } from "@/lib/newsletter-sections";
import { toast } from "@/lib/toast";
import {
	UNSUBSCRIBE_STEPS,
	UNSUBSCRIBE_TEXT_FIELDS,
	getDefaultUnsubscribeTexts,
	getUnsubscribeTexts,
	toUnsubscribePageSettings,
} from "@/lib/unsubscribe-page";

const SAMPLE_EMAIL = "reader@example.com";

// Unsubscribe page: a preview of each step in the language picked above it, the lines of that language to change
// (empty follows the built-in text), a picture, whether it asks why; and on Stats, why people left. Saved with the bar.
export default function FormUnsubscribePage({ newsletterId, newsletterName, language, settings, stats, defaultTab }) {
	const [saved, setSaved] = useState(() => toDraft(settings));
	const [draft, setDraft] = useState(saved);
	const [savedAt, setSavedAt] = useState(null);
	const [isSaving, startSaving] = useTransition();
	const [editing, setEditing] = useState(language);
	const [step, setStep] = useState("confirm");
	const [discardCount, setDiscardCount] = useState(0);
	const texts = getUnsubscribeTexts(toInput(draft), editing);
	const defaults = getDefaultUnsubscribeTexts(editing);
	const isDirty = JSON.stringify(toInput(draft)) !== JSON.stringify(toInput(saved));

	function setLine(key, value) {
		setDraft((current) => ({ ...current, texts: { ...current.texts, [editing]: { ...current.texts[editing], [key]: value } } }));
	}

	function save(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await saveUnsubscribePage(newsletterId, toInput(draft));
			if (result?.error) return void toast.error(result.error);
			const next = toDraft(fromOutput(result.unsubscribePage));
			setSaved(next);
			setDraft(next);
			setSavedAt(Date.now());
		});
	}

	function discard() {
		setDraft(saved);
		setSavedAt(null);
		setDiscardCount((count) => count + 1);
	}

	const languageLabel = EMAIL_LANGUAGE_OPTIONS.find(({ id }) => id === language)?.label;
	const fields = UNSUBSCRIBE_TEXT_FIELDS.filter((field) => field.step === step);

	return (
		<Tabs defaultValue={defaultTab} className="gap-4">
			<TabsList>
				<TabsTrigger value="form" className="px-3">
					Unsubscribe form
				</TabsTrigger>
				<TabsTrigger value="stats" className="px-3">
					Unsubscribe stats
				</TabsTrigger>
			</TabsList>

			<TabsContent value="form">
				<form onSubmit={save} className="flex flex-col gap-4">
					<Section
						title="Preview"
						stagger={1}
						action={
							<Select value={editing} onValueChange={setEditing}>
								<SelectTrigger size="sm" aria-label="Language" className="w-36">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{EMAIL_LANGUAGE_OPTIONS.map(({ id, label }) => (
										<SelectItem key={id} value={id}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
					>
						<div className="flex justify-center px-4 pt-3">
							<Segmented
								size="sm"
								label="Step"
								value={step}
								options={UNSUBSCRIBE_STEPS.map(({ id, label }) => ({ value: id, label, content: label }))}
								onChange={setStep}
							/>
						</div>
						<div className="flex justify-center bg-muted/40 bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-size-[16px_16px] px-4 py-10">
							<CardUnsubscribe
								step={step}
								texts={texts}
								values={{ newsletter: newsletterName, email: SAMPLE_EMAIL }}
								imageUrl={draft.imageUrl}
								askReason={draft.askReason}
							/>
						</div>
						<p className="px-4 py-3 text-xs text-pretty text-muted-foreground">
							Readers see it in {languageLabel}, your emails&apos; language:{" "}
							<Link href={getSectionPath("sender")} className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">
								Sender
							</Link>
							. {"{$newsletter}"} and {"{$email}"} become your newsletter&apos;s name and their address.
						</p>
					</Section>

					<Section title={`Content · ${EMAIL_LANGUAGE_OPTIONS.find(({ id }) => id === editing)?.label} · ${UNSUBSCRIBE_STEPS.find(({ id }) => id === step)?.label}`} stagger={2}>
						{step === "confirm" && (
							<Field label="Picture" hint="Above the question, any size: it fills the card's width. Empty: an icon.">
								<span className="flex items-center gap-3">
									<InputImage
										key={discardCount}
										name="unsubscribeImageUrl"
										defaultValue={draft.imageUrl}
										label="unsubscribe page picture"
										onChange={(imageUrl) => setDraft((current) => ({ ...current, imageUrl }))}
									/>
									{draft.imageUrl && (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => {
												setDraft((current) => ({ ...current, imageUrl: "" }));
												setDiscardCount((count) => count + 1);
											}}
										>
											Remove
										</Button>
									)}
								</span>
							</Field>
						)}
						{step === "done" && (
							<Field label="Ask why" as="div">
								<label className="flex items-center gap-3 text-sm text-muted-foreground sm:pt-2">
									<Switch
										checked={draft.askReason}
										onCheckedChange={(askReason) => setDraft((current) => ({ ...current, askReason }))}
									/>
									After unsubscribing, optional for readers
								</label>
							</Field>
						)}
						{fields
							.filter((field) => step !== "done" || draft.askReason || !isReasonField(field.key))
							.map((field) => (
								<FieldLine
									key={`${editing}-${field.key}`}
									field={field}
									value={draft.texts[editing][field.key] ?? ""}
									builtIn={defaults[field.key]}
									onChange={(value) => setLine(field.key, value)}
								/>
							))}
					</Section>
					<BarSave isDirty={isDirty} isSaving={isSaving} savedAt={savedAt} onDiscard={discard} />
				</form>
			</TabsContent>

			<TabsContent value="stats">
				<TableReasons stats={stats} />
			</TabsContent>
		</Tabs>
	);
}

// A line of the page: empty shows the built-in text as its placeholder, and follows it.
function FieldLine({ field, value, builtIn, onChange }) {
	const Control = field.multiline ? Textarea : Input;
	const isChanged = Boolean(value.trim()) && value.trim() !== builtIn;
	return (
		<Field label={field.label} hint={field.hint}>
			<span className="flex items-start gap-2">
				<Control
					value={value}
					maxLength={field.limit}
					placeholder={builtIn || "Optional"}
					onChange={(event) => onChange(event.target.value)}
					{...(field.multiline && { rows: 2, className: "min-h-0 resize-y" })}
				/>
				{isChanged && (
					<Button type="button" variant="ghost" size="icon" aria-label="Back to the built-in text" title="Back to the built-in text" onClick={() => onChange("")}>
						<RotateCcw />
					</Button>
				)}
			</span>
		</Field>
	);
}

function TableReasons({ stats }) {
	const { unsubscribed, reasons, noReason, otherAnswers } = stats;
	const percent = (count) => (unsubscribed ? `${((count / unsubscribed) * 100).toFixed(count && count / unsubscribed < 0.1 ? 1 : 0)}%` : "0%");
	return (
		<div className="flex flex-col gap-4">
			<Section title="Unsubscribe reasons" stagger={1}>
				<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 px-4 py-2.5 text-xs text-muted-foreground">
					<span>Reason</span>
					<span>Subscribers</span>
				</div>
				{[...reasons, { code: "none", label: "Didn't say", count: noReason }].map(({ code, label, count }) => (
					<div key={code} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 px-4 py-3 text-sm">
						<span className={code === "none" ? "text-muted-foreground" : undefined}>{label}</span>
						<span className="tabular-nums">
							{percent(count)} <span className="text-muted-foreground">({formatNumber(count)})</span>
						</span>
					</div>
				))}
				<p className="px-4 py-3 text-xs text-pretty text-muted-foreground">
					Of {formatNumber(unsubscribed)} unsubscribed now. Didn&apos;t say: the one-click button in their mail app, imports, or no answer.
				</p>
			</Section>
			{otherAnswers.length > 0 && (
				<Section title="In their own words" stagger={2}>
					{otherAnswers.map(({ text, at }, index) => (
						<div key={index} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
							<span className="text-pretty whitespace-pre-line">{text}</span>
							{at && <span className="text-xs text-muted-foreground">{new Date(at).toLocaleDateString()}</span>}
						</div>
					))}
				</Section>
			)}
		</div>
	);
}

function isReasonField(key) {
	return key.startsWith("reason_") || ["reasonsTitle", "otherPlaceholder", "submit"].includes(key);
}

// The draft holds every language's changed lines; empty ones follow the built-in text.
function toDraft(settings) {
	const { askReason, imageUrl, texts } = toUnsubscribePageSettings(settings);
	return { askReason, imageUrl, texts };
}

// What saving sends: every line of every language, empty for the built-in ones, so a line taken back is cleared.
function toInput(draft) {
	const texts = Object.fromEntries(
		EMAIL_LANGUAGE_OPTIONS.map(({ id }) => [
			id,
			Object.fromEntries(UNSUBSCRIBE_TEXT_FIELDS.map(({ key }) => [key, (draft.texts[id]?.[key] ?? "").trim()])),
		])
	);
	return { askReason: draft.askReason, imageUrl: draft.imageUrl.trim(), texts };
}

// update_newsletter's answer has every line; only those that differ are the owner's.
function fromOutput(unsubscribePage) {
	const texts = Object.fromEntries(
		Object.entries(unsubscribePage.texts).map(([id, lines]) => [
			id,
			Object.fromEntries((unsubscribePage.customized[id] ?? []).map((key) => [key, lines[key]])),
		])
	);
	return { askReason: unsubscribePage.askReason, imageUrl: unsubscribePage.imageUrl, texts };
}
