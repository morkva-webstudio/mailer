import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// The email of an automation's Send email step: written in the campaign editor, sent to one contact at a time. Not a
// Campaign, so it never shows in the campaigns, the archive or their stats.
const automationEmailSchema = new mongoose.Schema(
	{
		automationId: { type: mongoose.Schema.Types.ObjectId, ref: "Automation", required: true },
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		name: { type: String, trim: true, default: "" },
		subject: { type: String, trim: true, default: "" },
		previewText: { type: String, trim: true, default: "" },
		format: { type: String, enum: ["rich", "html"], default: "rich" },
		html: { type: String, default: "" },
		// Its footer's language (lib/email-language.js); empty: the newsletter's.
		language: { type: String, default: "" },
		// UTM parameters on its links (lib/utm.js).
		utm: {
			enabled: { type: Boolean, default: false },
			source: { type: String, default: "" },
			medium: { type: String, default: "" },
			campaign: { type: String, default: "" },
		},
	},
	{ timestamps: true }
);

automationEmailSchema.plugin(accountScoped);
automationEmailSchema.index({ accountId: 1, automationId: 1 });

export default mongoose.models.AutomationEmail || mongoose.model("AutomationEmail", automationEmailSchema);
