const mongoose = require("mongoose");

const blockSchema = new mongoose.Schema({
    user1: mongoose.Schema.Types.ObjectId,
    user2: mongoose.Schema.Types.ObjectId
}, { timestamps: true });

module.exports = mongoose.model("ChatBlock", blockSchema);