const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
    reporterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },
    reportedUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },
    reason: String,
    status: {
        type: String,
        default: "pending"
    }
}, { timestamps: true });

module.exports = mongoose.model("Report", reportSchema);