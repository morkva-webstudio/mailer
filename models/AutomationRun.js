import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";
import { RUN_STATUSES } from "../lib/automation-steps.js";

// One contact's pass through an automation. waiting: at stepId until nextAt (lib/automations.js runs it then).
// canceled: it left before the end, unsubscribed or taken out; failed: a step couldn't run.
const automationRunSchema = new mongoose.Schema(
	{
		automationId: { type: mongoose.Schema.Types.ObjectId, ref: "Automation", required: true },
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true },
		email: { type: String, required: true, lowercase: true, trim: true },
		status: { type: String, enum: RUN_STATUSES, default: "waiting" },
		stepId: { type: String },
		nextAt: { type: Date },
		// The delay step whose wait it started: at nextAt it goes on past it.
		waitingOn: { type: String },
		// A runner has it until then, so two never run the same step.
		claimedUntil: { type: Date },
		// How the contact got in: the trigger, or by hand (Add subscribers).
		via: { type: String },
		finishedAt: { type: Date },
		reason: { type: String },
		history: {
			type: [{ _id: false, stepId: String, type: { type: String }, at: Date, result: String }],
			default: undefined,
		},
	},
	{ timestamps: true }
);

automationRunSchema.plugin(accountScoped);
automationRunSchema.index({ status: 1, nextAt: 1 });
automationRunSchema.index({ accountId: 1, automationId: 1, status: 1, updatedAt: -1 });
// One pass at a time per contact: a trigger firing twice at once can't let the contact in twice.
automationRunSchema.index(
	{ automationId: 1, contactId: 1 },
	{ unique: true, partialFilterExpression: { status: "waiting" } }
);
automationRunSchema.index({ automationId: 1, contactId: 1, status: 1 });

export default mongoose.models.AutomationRun || mongoose.model("AutomationRun", automationRunSchema);
