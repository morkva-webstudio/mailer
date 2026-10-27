import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";
import { AUTOMATION_STATUSES } from "../lib/automation-steps.js";

// A newsletter's workflow: a trigger lets its contacts in, and each goes through the steps (lib/automation-steps.js),
// one AutomationRun per contact and pass. draft: never started. paused: contacts in it wait where they are.
const automationSchema = new mongoose.Schema(
	{
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		name: { type: String, required: true, trim: true },
		status: { type: String, enum: AUTOMATION_STATUSES, default: "draft" },
		trigger: {
			type: { type: String },
			config: { type: mongoose.Schema.Types.Mixed },
		},
		// The step tree as the editor saved it: { id, type, config } and a condition's yes and no lists.
		steps: { type: mongoose.Schema.Types.Mixed, default: () => [] },
		// A contact who finished or left it goes through again when the trigger fires again.
		reenter: { type: Boolean, default: false },
		// Signs its webhooks (X-Mailer-Signature), so the receiver knows they come from it.
		webhookSecret: { type: String, select: false },
		activatedAt: { type: Date },
		// Date triggers: an exact date's single firing, and the last day an anniversary trigger let contacts in.
		firedAt: { type: Date },
		firedOn: { type: String },
		deletedAt: { type: Date },
	},
	{ timestamps: true, minimize: false }
);

automationSchema.plugin(accountScoped);
automationSchema.index({ accountId: 1, newsletterId: 1, createdAt: -1 });
// Triggers look up the live automations of a newsletter by their trigger's type.
automationSchema.index({ newsletterId: 1, status: 1, "trigger.type": 1 });

export default mongoose.models.Automation || mongoose.model("Automation", automationSchema);
