import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight, LayoutTemplate } from "lucide-react";
import BadgeSoon from "@/components/BadgeSoon";
import DialogCreateAutomation from "@/components/DialogCreateAutomation";
import HeaderPage from "@/components/HeaderPage";
import StateEmpty from "@/components/StateEmpty";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";

export const metadata = { title: "Choose template" };

// From scratch, or from a template once there are some.
export default async function NewAutomationPage() {
	const { selected } = await getSelectedNewsletter();
	const newsletterId = selected ? String(selected._id) : null;

	return (
		<>
			<nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground animate-enter">
				<Link href="/automations" className="hover:text-foreground">
					Automations
				</Link>
				<ChevronRight className="size-3.5" />
				<span className="text-foreground">Template</span>
			</nav>
			<HeaderPage title="Choose template" />

			<DialogCreateAutomation
				newsletterId={newsletterId}
				trigger={
					<button
						type="button"
						disabled={!newsletterId}
						className="mb-8 flex w-full flex-col items-start gap-2 rounded-xl p-6 text-left shadow-border transition-colors duration-150 hover:bg-muted/40 animate-enter"
					>
						<span className="font-medium">Start from scratch</span>
						<span className="text-sm text-muted-foreground">Pick up fresh and start building engaging automation with workflows from scratch.</span>
						<ArrowRight className="mt-2 size-4" />
					</button>
				}
			/>

			<section className="flex flex-col gap-4 rounded-xl p-6 shadow-border animate-enter">
				<button type="button" disabled className="flex h-9 w-56 items-center justify-between rounded-lg px-3 text-sm shadow-border disabled:opacity-60">
					All templates
					<span className="flex items-center gap-1.5">
						<BadgeSoon />
						<ChevronDown className="size-4" />
					</span>
				</button>
				<StateEmpty icon={LayoutTemplate} title="No templates yet" />
			</section>
		</>
	);
}
