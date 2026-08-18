const mongoose = require("mongoose");

const emailSettingsSchema = new mongoose.Schema({
    provider_type: { type: String, enum: ["NODE", "SMTP"], required: true },
    nodeFromName: { type: String },
    nodeFromEmail: { type: String },
    nodeHost: { type: String },
    nodePort: { type: String },
    nodeUsername: { type: String },
    nodePassword: { type: String },
    smtpFromName: { type: String },
    smtpFromEmail: { type: String },
    smtpHost: { type: String },
    smtpPort: { type: String },
    smtpUsername: { type: String },
    smtpPassword: { type: String },
    smtp_status: { type: Boolean, default: false },
    node_status: { type: Boolean, default: false },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

module.exports = mongoose.model("EmailSettings", emailSettingsSchema);
