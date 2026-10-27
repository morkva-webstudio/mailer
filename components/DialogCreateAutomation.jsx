"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { createAutomation } from "@/app/(app)/automations/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MAX_AUTOMATION_NAME } from "@/lib/automation-steps";
import { toast } from "@/lib/toast";

// An automation starts with its name, then opens in the editor.
export default function DialogCreateAutomation({ newsletterId, trigger }) {
	const [name, setName] = useState("");
	const [isPending, startTransition] = useTransition();

	function create(event) {
		event.preventDefault();
		startTransition(async () => {
			const result = await createAutomation(newsletterId, name);
			if (result?.error) toast.error(result.error);
		});
	}

	return (
		<Dialog onOpenChange={(open) => !open && setName("")}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<form onSubmit={create} className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>Create automation</DialogTitle>
						<DialogDescription>Guide your subscribers through every step of the journey, from the welcome email to the result you want.</DialogDescription>
					</DialogHeader>
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Enter automation name"
						aria-label="Automation name"
						maxLength={MAX_AUTOMATION_NAME}
						required
						autoFocus
					/>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="secondary">
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={!name.trim() || isPending}>
							Start building
							{isPending ? <Loader2 data-icon="inline-end" className="animate-spin" /> : <ArrowRight data-icon="inline-end" />}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
