require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);

// 🔥 ONLINE USERS STORE
const onlineUsers = new Set();


const io = new Server(server, {
    cors: { origin: "*" }
});
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cors());


// ✅ AUTH MIDDLEWARE (MOVE HERE)
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "No token" });

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch {
        res.status(401).json({ message: "Invalid token" });
    }
};
// =======================
// MongoDB Connection
// =======================

if (!process.env.MONGODB_URI) {
    console.error("❌ MONGODB_URI missing in .env");
    process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ MongoDB Error:", err));

// =======================
// Schemas
// =======================

const userSchema = new mongoose.Schema({
    username: String,
    email: { type: String, unique: true },
    phone: String,
    password: String,

    coins: { type: Number, default: 0 },

    referralCode: { type: String, unique: true },
    referredBy: { type: String, default: null },

    kycVerified: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },

    isBanned: { type: Boolean, default: false },
    reportCount: { type: Number, default: 0 },
    banReason: { type: String, default: "" }

}, { timestamps: true });
const User = mongoose.model("User", userSchema);

const buyRequestSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    coins: Number,
    status: { type: String, default: "pending" }
}, { timestamps: true });

const BuyRequest = mongoose.model("BuyRequest", buyRequestSchema);

const settingSchema = new mongoose.Schema({
    coinPrice: { type: Number, default: 85 }
});

const Setting = mongoose.model("Setting", settingSchema);

Setting.findOne().then(async setting => {
    if (!setting) {
        await Setting.create({ coinPrice: 85 });
    }
});

// ===== TRANSFER SCHEMA =====
const transferSchema = new mongoose.Schema({
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receiverEmail: String,
    coins: Number,
    code: String,
    status: { type: String, default: "pending" }
}, { timestamps: true });

const Transfer = mongoose.model("Transfer", transferSchema);

// ===== KYC SCHEMA =====
const kycSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    fullName: String,
    documentType: String,
    documentNumber: String,
    country: String,
    state: String,
    place: String,
    pincode: String,
    livePhoto: String,
    documentPhoto: String,
    status: { type: String, default: "pending" }
}, { timestamps: true });

const KYC = mongoose.model("KYC", kycSchema);


const sellSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true },
    pricePerCoin: { type: Number, required: true },
    active: { type: Boolean, default: false }
}, { timestamps: true });

const Sell = mongoose.model("Sell", sellSchema);
// ===== PRICE HISTORY SCHEMA =====
const priceHistorySchema = new mongoose.Schema({
    price: Number,
    date: { type: Date, default: Date.now }
});

const PriceHistory = mongoose.model("PriceHistory", priceHistorySchema);


const ChatBlock = require("./models/ChatBlock");
// =======================
// REGISTER
// =======================
const Report = require("./models/Report");
const Contact = require("./models/Contact");



function generateReferralCode() {
    return "WAI" + Math.random().toString(36).substring(2,8).toUpperCase();
}




app.post("/contact", async (req,res)=>{

    const { name, email, message } = req.body;

    if(!name || !email || !message){
        return res.status(400).json({ message:"All fields required" });
    }

    await Contact.create({ name, email, message });

    res.json({ message:"Message sent successfully!" });
});
app.delete("/admin/contact/:id", async (req,res)=>{

    const { id } = req.params;

    await Contact.findByIdAndDelete(id);

    res.json({ message:"Deleted successfully" });
});
app.get("/admin/contacts", async (req,res)=>{

    const contacts = await Contact.find()
        .sort({ createdAt:-1 });

    res.json(contacts);
});
app.post("/admin/chat/unblock", async (req, res) => {

    const { user1, user2 } = req.body;

    if (!user1 || !user2) {
        return res.status(400).json({ message: "Missing users" });
    }

    await ChatBlock.deleteOne({
        $or: [
            { user1, user2 },
            { user1: user2, user2: user1 }
        ]
    });

    res.json({ message: "Chat unblocked successfully" });
});
app.post("/report", authMiddleware, async (req, res) => {

    const { reportedUserId, reason } = req.body;

    if (!reportedUserId || !reason)
        return res.status(400).json({ message: "Missing data" });

    if (reportedUserId === req.userId)
        return res.status(400).json({ message: "Cannot report yourself" });

    await Report.create({
        reporterId: req.userId,
        reportedUserId,
        reason
    });

    const user = await User.findById(reportedUserId);

    user.reportCount += 1;

    if (user.reportCount >= 3) {
        user.isBanned = true;
        user.banReason = "Multiple user reports";
    }
    
    await ChatBlock.create({
    user1: req.userId,
    user2: reportedUserId
});
    await user.save();

    const reportsWithBlock = await Promise.all(
    reports.map(async report => {

        const blocked = await ChatBlock.findOne({
            $or: [
                { user1: report.reporterId._id, user2: report.reportedUserId._id },
                { user1: report.reportedUserId._id, user2: report.reporterId._id }
            ]
        });

        return {
            ...report.toObject(),
            isChatBlocked: !!blocked
        };
    })
);

res.json(reportsWithBlock);
});




app.post('/admin/set-price', async (req, res) => {
    const { price } = req.body;

    const setting = await Setting.findOne();
    setting.coinPrice = price;
    await setting.save();

    // 🔥 Save daily price history
    await PriceHistory.create({
        price: Number(price)
    });

    res.json({ message: "Price updated & history saved" });
});
app.get('/price-history/:range', async (req, res) => {

    const range = req.params.range;
    let startDate = new Date();

    if (range === "3d") {
        startDate.setDate(startDate.getDate() - 3);
    }
    else if (range === "7d") {
        startDate.setDate(startDate.getDate() - 7);
    }
    else if (range === "1m") {
        startDate.setMonth(startDate.getMonth() - 1);
    }
    else if (range === "3m") {
        startDate.setMonth(startDate.getMonth() - 3);
    }
    else if (range === "6m") {
        startDate.setMonth(startDate.getMonth() - 6);
    }
    else if (range === "1y") {
        startDate.setFullYear(startDate.getFullYear() - 1);
    }
    else if (range === "all") {
        startDate = new Date(0); // 🔥 from beginning
    }

    const history = await PriceHistory.find({
        date: { $gte: startDate }
    }).sort({ date: 1 });

    res.json(history);
});
app.post('/register', async (req, res) => {

    const { username, email, phone, password, confirmPassword, referralCode } = req.body;

    if (!username || !email || !password || password !== confirmPassword) {
        return res.status(400).json({ message: "Invalid data" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
        return res.status(400).json({ message: "User exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const myReferralCode = generateReferralCode();

    // 🎁 Signup bonus
    let coins = 5;

    // 🔥 If referral used
    if (referralCode) {

        const refUser = await User.findOne({ referralCode });

        if (refUser) {
            refUser.coins += 2; // reward user A
            await refUser.save();
        }
    }

    await User.create({
        username,
        email,
        phone,
        password: hashedPassword,
        coins,
        referralCode: myReferralCode,
        referredBy: referralCode || null
    });

    res.json({
        message: "Registered successfully",
        bonus: "5 coins added"
    });

});
app.get('/my-referral', authMiddleware, async (req,res)=>{

    const user = await User.findById(req.userId)
        .select("referralCode");

    res.json({
        referralCode: user.referralCode
    });

});
// =======================
// LOGIN (Still Protected)
// =======================
app.post('/login', async (req, res) => {

    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) 
        return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) 
        return res.status(400).json({ message: "Wrong password" });

    // 🔥 CHECK BAN AFTER PASSWORD MATCH
    if (user.isBanned) {
        return res.status(403).json({
            message: "Your account is banned. Contact admin for unban request."
        });
    }

    const token = jwt.sign(
        { userId: user._id },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

    res.json({ token });
});
// BAN USER
app.post('/admin/ban/:id', async (req, res) => {

    const { reason } = req.body;

    await User.findByIdAndUpdate(req.params.id, {
        isBanned: true,
        banReason: reason || "Violation of rules"
    });

    res.json({ message: "User banned" });
});

// UNBAN USER
app.post('/admin/unban/:id', async (req, res) => {

    await User.findByIdAndUpdate(req.params.id, {
        isBanned: false,
        banReason: ""
    });

    res.json({ message: "User unbanned" });
});
// =======================
// AUTH MIDDLEWARE (For Users Only)
// =======================


// =======================
// USER ROUTES (Still Protected)
// =======================


app.post('/buy', authMiddleware, async (req, res) => {
    const { coins } = req.body;

    await BuyRequest.create({
        userId: req.userId,
        coins
    });

    res.json({ message: "Buy request sent" });
});

// =======================
// ADMIN ROUTES (FULLY OPEN)
// =======================

app.get('/admin/users', async (req, res) => {
    const users = await User.find()
        .select("-password")
        .sort({ createdAt: -1 });

    res.json(users);
});

app.get('/admin/user/:id', async (req, res) => {

    const user = await User.findById(req.params.id)
        .select("-password");

    const kyc = await KYC.findOne({ userId: req.params.id });

    res.json({
        ...user.toObject(),
        kycData: kyc || null,
        isOnline: onlineUsers.has(req.params.id)
    });
});
app.delete('/admin/user/:id', async (req, res) => {
    try {

        const userId = req.params.id;

        // Delete user
        await User.findByIdAndDelete(userId);

        // Delete related data
        await KYC.deleteMany({ userId });
        await BuyRequest.deleteMany({ userId });
        await Transfer.deleteMany({
            $or: [
                { senderId: userId },
                { receiverEmail: { $exists: true } }
            ]
        });
        await Sell.deleteMany({ userId });
        await Message.deleteMany({
            $or: [
                { senderId: userId },
                { receiverId: userId }
            ]
        });

        res.json({ message: "User deleted successfully" });

    } catch (error) {
        res.status(500).json({ message: "Delete failed" });
    }
});
app.post('/admin/add-coins/:id', async (req, res) => {
    const { coins } = req.body;
    const user = await User.findById(req.params.id);
    user.coins += Number(coins);
    await user.save();
    res.json({ message: "Coins added" });
});

app.post('/admin/verify-kyc/:id', async (req, res) => {
    const user = await User.findById(req.params.id);
    user.kycVerified = true;
    await user.save();
    res.json({ message: "KYC verified" });
});

app.get('/admin/requests', async (req, res) => {
    const requests = await BuyRequest.find()
        .populate("userId", "username email coins");
    res.json(requests);
});
app.get('/my-coins', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select("coins");

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json({
            coins: user.coins || 0
        });

    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
});
// ===== GET COIN PRICE (PUBLIC) =====
app.get('/coin-price', async (req, res) => {
    try {
        const setting = await Setting.findOne();
        res.json({ price: setting.coinPrice });
    } catch (error) {
        res.status(500).json({ message: "Error fetching price" });
    }
});
app.post('/admin/approve/:id', async (req, res) => {
    const request = await BuyRequest.findById(req.params.id);

    if (!request || request.status !== "pending")
        return res.status(400).json({ message: "Invalid request" });

    const user = await User.findById(request.userId);
    user.coins += request.coins;
    await user.save();

    request.status = "approved";
    await request.save();

    res.json({ message: "Approved" });
});

app.post('/admin/reject/:id', async (req, res) => {
    const request = await BuyRequest.findById(req.params.id);
    request.status = "rejected";
    await request.save();
    res.json({ message: "Rejected" });
});



// CREATE TRANSFER
app.post('/transfer/create', authMiddleware, async (req, res) => {

    try {

        const { receiverEmail, coins } = req.body;

        // 🔥 Validate input
        if (!receiverEmail || !coins || coins <= 0) {
            return res.status(400).json({ message: "Invalid data" });
        }

        const sender = await User.findById(req.userId);

        if (!sender) {
            return res.status(404).json({ message: "User not found" });
        }

        // 🔐 1️⃣ KYC PROTECTION
        if (sender.kycStatus !== "approved") {
            return res.status(403).json({ message: "KYC not approved" });
        }

        // 🔐 2️⃣ Balance Check
        if (sender.coins < coins) {
            return res.status(400).json({ message: "Not enough coins" });
        }

        // 🔐 3️⃣ Prevent self-transfer
        if (sender.email === receiverEmail) {
            return res.status(400).json({ message: "Cannot transfer to yourself" });
        }

        // 🔐 4️⃣ Generate secure random code
        const code = require("crypto")
            .randomBytes(4)
            .toString("hex")
            .toUpperCase();

        await Transfer.create({
            senderId: req.userId,
            receiverEmail,
            coins,
            code
        });

        res.json({ code });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});
// REDEEM TRANSFER
app.post('/transfer/redeem', authMiddleware, async (req, res) => {

    const { code } = req.body;

    const transfer = await Transfer.findOne({ code, status: "pending" });

    if (!transfer)
        return res.status(400).json({ message: "Invalid code" });

    const sender = await User.findById(transfer.senderId);
    const receiver = await User.findById(req.userId);

    if (receiver.email !== transfer.receiverEmail)
        return res.status(400).json({ message: "This code is not for you" });

    if (sender.coins < transfer.coins)
        return res.status(400).json({ message: "Sender has insufficient coins" });

    // Transfer coins
    sender.coins -= transfer.coins;
    receiver.coins += transfer.coins;

    await sender.save();
    await receiver.save();

    transfer.status = "completed";
    await transfer.save();

    res.json({ message: "Transfer successful" });
});

// SUBMIT KYC
app.post('/kyc/submit', authMiddleware, async (req, res) => {

    const {
        fullName,
        documentType,
        documentNumber,
        country,
        state,
        place,
        pincode,
        livePhoto,
        documentPhoto
    } = req.body;

    let existingKyc = await KYC.findOne({ userId: req.userId });

    if (existingKyc) {

        // 🔥 UPDATE EXISTING KYC
        existingKyc.fullName = fullName;
        existingKyc.documentType = documentType;
        existingKyc.documentNumber = documentNumber;
        existingKyc.country = country;
        existingKyc.state = state;
        existingKyc.place = place;
        existingKyc.pincode = pincode;
        existingKyc.livePhoto = livePhoto;
        existingKyc.documentPhoto = documentPhoto;

        existingKyc.status = "pending"; // 🔥 RESET STATUS

        await existingKyc.save();

    } else {

        await KYC.create({
            userId: req.userId,
            fullName,
            documentType,
            documentNumber,
            country,
            state,
            place,
            pincode,
            livePhoto,
            documentPhoto,
            status: "pending"
        });
    }

    res.json({ message: "KYC Submitted Successfully" });
});
// GET ALL KYC
app.get("/admin/kyc", async (req, res) => {

    const { status } = req.query;

    const filter = status ? { status } : {};

    const kycList = await KYC.find(filter)
        .populate("userId", "username email") // 🔥 only needed fields
        .lean(); // 🔥 faster

    res.json(kycList);
});
app.post('/admin/kyc/approve/:id', async (req, res) => {

    const kyc = await KYC.findById(req.params.id);
    if(!kyc) return res.status(404).json({ message: "KYC not found" });

    kyc.status = "approved";
    await kyc.save();

    await User.findByIdAndUpdate(kyc.userId, {
        kycVerified: true
    });

    res.json({ message: "KYC Approved" });
});


app.post('/admin/kyc/reject/:id', async (req, res) => {

    const kyc = await KYC.findById(req.params.id);
    if(!kyc) return res.status(404).json({ message: "KYC not found" });

    kyc.status = "rejected";
    await kyc.save();

    await User.findByIdAndUpdate(kyc.userId, {
        kycVerified: false
    });

    res.json({ message: "KYC Rejected" });
});


app.get('/kyc/status', authMiddleware, async (req, res) => {

    const kyc = await KYC.findOne({ userId: req.userId });

    if (!kyc) {
        return res.json({ status: "not_submitted" });
    }

    res.json({ status: kyc.status });
});
app.post('/sell/create', authMiddleware, async (req, res) => {

    let { coins, pricePerCoin } = req.body;

    coins = Number(coins);
    pricePerCoin = Number(pricePerCoin);

    if (!coins || !pricePerCoin || coins <= 0 || pricePerCoin <= 0) {
        return res.status(400).json({ message: "Invalid data" });
    }

    const user = await User.findById(req.userId);

    if (!user) {
        return res.status(404).json({ message: "User not found" });
    }

    if (coins > user.coins) {
        return res.status(400).json({ message: "Not enough coins" });
    }

    const totalAmount = coins * pricePerCoin;

    // 🔥 IMPORTANT: deduct coins immediately
    user.coins -= coins;
    await user.save();

    await Sell.create({
        userId: req.userId,
        coins,
        pricePerCoin,
        totalAmount,
        status: "active"
    });

    res.json({ message: "Sell order created" });
});

app.post('/sell/toggle', authMiddleware, async (req, res) => {

    const sell = await Sell.findOne({ userId: req.userId });

    if (!sell) {
        return res.status(400).json({ message: "Setup price first" });
    }

    sell.active = !sell.active;
    await sell.save();

    res.json({ message: "Status updated", active: sell.active });
});

app.post('/sell/remove/:id', authMiddleware, async (req, res) => {

    const sell = await Sell.findById(req.params.id);

    if (!sell) {
        return res.status(404).json({ message: "Order not found" });
    }

    if (sell.userId.toString() !== req.userId) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    const user = await User.findById(req.userId);

    // 🔥 Return coins back
    user.coins += sell.coins;
    await user.save();

    await sell.deleteOne();

    res.json({ message: "Sell order removed and coins returned" });
});
// GET ALL ACTIVE SELL ORDERS
// GET ONLY APPROVED SELLERS ORDERS
app.get('/sell/all', authMiddleware, async (req, res) => {

    const myId = req.userId;

    const sells = await Sell.find({ active: true })
        .populate("userId", "username")
        .sort({ createdAt: -1 });

    const result = await Promise.all(
        sells.map(async order => {

            const sellerId = order.userId._id.toString();

            const unreadCount = await Message.countDocuments({
                senderId: sellerId,
                receiverId: myId,
                seen: false
            });

            return {
                ...order.toObject(),
                isOnline: onlineUsers.has(sellerId),
                unreadCount
            };
        })
    );

    // 🔥 SORT ONLINE FIRST
    result.sort((a,b) => b.isOnline - a.isOnline);

    res.json(result);
});

// BUY COINS FROM SELL ORDER
app.post('/sell/buy/:id', authMiddleware, async (req, res) => {

    const { coins } = req.body;

    const sellOrder = await Sell.findOne({
        userId: req.params.id,
        active: true
    });

    if (!sellOrder) {
        return res.status(400).json({ message: "Seller not active" });
    }

    const seller = await User.findById(req.params.id);
    const buyer = await User.findById(req.userId);

    coinsNumber = Number(coins);

    if (!coinsNumber || coinsNumber <= 0) {
        return res.status(400).json({ message: "Invalid amount" });
    }

    if (seller.coins < coinsNumber) {
        return res.status(400).json({ message: "Seller has insufficient coins" });
    }

    // 🔥 Transfer coins
    seller.coins -= coinsNumber;
    buyer.coins += coinsNumber;

    await seller.save();
    await buyer.save();

    res.json({ message: "Coins transferred successfully" });
});
app.get('/sell/my', authMiddleware, async (req, res) => {

    const sell = await Sell.findOne({ userId: req.userId });

    res.json(sell || null);
});
// =======================
// START SERVER
// =======================
const messageSchema = new mongoose.Schema({
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: String,
    image: String,   // 🔥 add this
    seen: { type: Boolean, default: false }
}, { timestamps: true });
const Message = mongoose.model("Message", messageSchema);


app.post('/message/send', authMiddleware, async (req, res) => {

    const { receiverId, text, image } = req.body;

    const sender = await User.findById(req.userId);
    const receiver = await User.findById(receiverId);

    // 🚨 BLOCK IF BANNED
    if (sender.isBanned)
        return res.status(403).json({ message: "You are banned" });

    if (receiver.isBanned)
        return res.status(403).json({ message: "User is banned" });

    // 🚨 CHECK IF CHAT BLOCKED
const blocked = await ChatBlock.findOne({
    $or: [
        { user1: req.userId, user2: receiverId },
        { user1: receiverId, user2: req.userId }
    ]
});

if (blocked)
    return res.status(403).json({ message: "Chat is blocked" });

    // 🚨 AUTO SCAM WORD DETECTION
    const scamWords = ["upi", "whatsapp", "telegram", "outside", "bank transfer"];
    const textLower = (text || "").toLowerCase();

    const isScam = scamWords.some(word => textLower.includes(word));

    if (isScam) {

        await Report.create({
            reporterId: req.userId,
            reportedUserId: req.userId,
            reason: "Auto scam word detected"
        });

        sender.reportCount += 1;

        if (sender.reportCount >= 3) {
            sender.isBanned = true;
            sender.banReason = "Multiple scam violations";
        }

        await sender.save();
    }

    const newMessage = await Message.create({
        senderId: req.userId,
        receiverId,
        text,
        image
    });

    io.to(receiverId).emit("receiveMessage", {
        senderId: req.userId,
        text,
        image,
        createdAt: newMessage.createdAt
    });

    res.json({ message: "Sent" });
});
// GET SELLER INFO
app.get('/user/:id', authMiddleware, async (req, res) => {

    const user = await User.findById(req.params.id).select("username");

    const sell = await Sell.findOne({ userId: req.params.id });

    res.json({
        username: user?.username || "User",
        pricePerCoin: sell?.active ? sell.pricePerCoin : null,
        active: sell?.active || false,
        isOnline: onlineUsers.has(req.params.id)
    });
});
app.post('/coins/send', authMiddleware, async (req, res) => {

    const { receiverId, coins } = req.body;

    const sender = await User.findById(req.userId);
    const receiver = await User.findById(receiverId);

    const amount = Number(coins);

    if (!receiver)
        return res.status(404).json({ message: "Receiver not found" });

    if (!amount || amount <= 0)
        return res.status(400).json({ message: "Invalid amount" });

    if (sender.coins < amount)
        return res.status(400).json({ message: "Insufficient coins" });

    // 🔥 TRANSFER
    sender.coins -= amount;
    receiver.coins += amount;

    await sender.save();
    await receiver.save();

    res.json({ message: "Coins sent successfully" });
});
app.get('/message/inbox', authMiddleware, async (req, res) => {

    const myId = req.userId.toString();

    const messages = await Message.find({
        $or: [
            { senderId: myId },
            { receiverId: myId }
        ]
    })
    .populate("senderId", "username")
    .populate("receiverId", "username")
    .sort({ createdAt: -1 });

    const usersMap = {};

    for (let msg of messages) {

        const senderId = msg.senderId._id.toString();
        const receiverId = msg.receiverId._id.toString();

        const isMeSender = senderId === myId;

        const otherUser = isMeSender
            ? msg.receiverId
            : msg.senderId;

        const otherId = otherUser._id.toString();

        if (!usersMap[otherId]) {
            usersMap[otherId] = {
                _id: otherId,
                username: otherUser.username,
                unreadCount: 0,
                isOnline: onlineUsers.has(otherId)
            };
        }

        // Count only unread messages I received
        if (!isMeSender && !msg.seen) {
            usersMap[otherId].unreadCount += 1;
        }
    }

    const result = Object.values(usersMap);

    // 🔥 Sort: Online first
    result.sort((a, b) => b.isOnline - a.isOnline);

    res.json(result);
});
app.get("/admin/reports", authMiddleware, async (req, res) => {

    const reports = await Report.find()
        .populate("reporterId", "username email")
        .populate("reportedUserId", "username email")
        .sort({ createdAt: -1 });

    const reportsWithBlockStatus = await Promise.all(
        reports.map(async (report) => {

            const blocked = await ChatBlock.findOne({
                $or: [
                    { user1: report.reporterId._id, user2: report.reportedUserId._id },
                    { user1: report.reportedUserId._id, user2: report.reporterId._id }
                ]
            });

            return {
                ...report.toObject(),
                isChatBlocked: !!blocked
            };
        })
    );

    res.json(reportsWithBlockStatus);
});
app.put("/admin/review/:id", authMiddleware, async (req, res) => {

    try {

        await Report.findByIdAndUpdate(req.params.id, {
            status: "reviewed"
        });

        res.json({ message: "Report reviewed" });

    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }

});
app.post('/message/mark-seen', authMiddleware, async (req, res) => {

    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ message: "UserId required" });
    }

    await Message.updateMany(
        {
            senderId: userId,
            receiverId: req.userId,
            seen: false
        },
        { $set: { seen: true } }
    );

    res.json({ message: "Seen updated" });
});
app.get('/message/:userId', authMiddleware, async (req, res) => {

    const myId = req.userId;
    const otherId = req.params.userId;

    // 🔥 AUTO MARK AS SEEN WHEN CHAT OPENS
    await Message.updateMany(
        {
            senderId: otherId,
            receiverId: myId,
            seen: false
        },
        { $set: { seen: true } }
    );

    const messages = await Message.find({
        $or:[
            { senderId: myId, receiverId: otherId },
            { senderId: otherId, receiverId: myId }
        ]
    }).sort({ createdAt: 1 });

    res.json(messages);
});
app.post('/sell/setup', authMiddleware, async (req, res) => {

    const { pricePerCoin } = req.body;

    const price = Number(pricePerCoin);

    if (!price || price <= 0) {
        return res.status(400).json({ message: "Invalid price" });
    }

    let sell = await Sell.findOne({ userId: req.userId });

    if (sell) {
        sell.pricePerCoin = price;
        await sell.save();
    } else {
        await Sell.create({
            userId: req.userId,
            pricePerCoin: price,
            active: false
        });
    }

    res.json({ message: "Sell price saved" });
});
app.get('/admin/stats', async (req, res) => {

    const totalUsers = await User.countDocuments();
    const bannedUsers = await User.countDocuments({ isBanned: true });

    const approvedKYC = await KYC.countDocuments({ status: "approved" });
    const pendingKYC = await KYC.countDocuments({ status: "pending" });
    const rejectedKYC = await KYC.countDocuments({ status: "rejected" });

    const totalCoinsData = await User.aggregate([
        { $group: { _id: null, totalCoins: { $sum: "$coins" } } }
    ]);

    const totalCoins = totalCoinsData[0]?.totalCoins || 0;

    res.json({
        totalUsers,
        bannedUsers,
        approvedKYC,
        pendingKYC,
        rejectedKYC,
        totalCoins
    });
});
// ===== SOCKET SETUP =====
io.on("connection", (socket) => {

    socket.on("join", async (userId) => {
        socket.join(userId);
        onlineUsers.add(userId);

        // ✅ update last seen when user comes online
        await User.findByIdAndUpdate(userId, {
            lastSeen: new Date()
        });

        io.emit("onlineUsers", Array.from(onlineUsers));
    });

    socket.on("disconnect", async () => {

        for (let userId of onlineUsers) {
            if (io.sockets.adapter.rooms.get(userId)?.size === 0) {

                onlineUsers.delete(userId);

                // ✅ update last seen when user goes offline
                await User.findByIdAndUpdate(userId, {
                    lastSeen: new Date()
                });
            }
        }

        io.emit("onlineUsers", Array.from(onlineUsers));
    });
});
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});