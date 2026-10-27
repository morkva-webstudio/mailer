import { runAutomations } from "@/lib/automations";
import { withCronSecret } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Every minute: date triggers let their contacts in, and contacts whose next step is due take it.
export const GET = withCronSecret(async () => {
	const result = await runAutomations();
	if (result.enrolled > 0 || result.runs > 0) console.info(`[automations] ${JSON.stringify(result)}`);
	return result;
});
