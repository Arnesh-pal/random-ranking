// Import necessary packages
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

// Import Mongoose Models
const User = require('./models/User');
const ClaimHistory = require('./models/ClaimHistory');

// Initialize App
const app = express();

// --- Production Grade CORS Configuration ---
const allowedOrigins = [
    'http://localhost:3000', // For local development
    process.env.FRONTEND_URL  // For the deployed Vercel app (you'll set this on Render)
];

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
};

app.use(cors(corsOptions));
app.use(express.json());

// --- Server and Socket.IO Setup ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
    },
});

// --- Database Connection ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB connected successfully");
        seedDatabase(); // Function to add initial users
    })
    .catch((err) => console.error("MongoDB connection error:", err));

// --- Helper Function for Leaderboard ---
const getLeaderboard = async () => {
    const users = await User.find({}).sort({ totalPoints: -1 });
    // Assign ranks
    return users.map((user, index) => ({
        rank: index + 1,
        name: user.name,
        totalPoints: user.totalPoints,
        _id: user._id,
    }));
};

// --- API Routes ---

// ROOT ROUTE - For confirming the server is live
app.get('/', (req, res) => {
    res.status(200).json({ message: 'Welcome to the Random Ranking API!' });
});

// HEALTH CHECK ROUTE - For Uptime Robot
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP' });
});


// GET: Fetch all users
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({});
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// POST: Add a new user with improved error handling
app.post('/api/users', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ message: 'Name is required' });
        }
        const newUser = new User({ name });
        await newUser.save();
        io.emit('leaderboardUpdate', await getLeaderboard()); // Broadcast update
        res.status(201).json(newUser);
    } catch (error) {
        // Check for duplicate key error (code 11000)
        if (error.code === 11000) {
            return res.status(409).json({ message: 'Error: This user name already exists.' });
        }
        res.status(500).json({ message: 'Error adding user' });
    }
});

// POST: Claim points for a user
app.post('/api/claim', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ message: 'User ID is required' });
        }
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const randomPoints = Math.floor(Math.random() * 10) + 1;
        user.totalPoints += randomPoints;
        await user.save();

        // Create a history record
        const historyRecord = new ClaimHistory({
            userId: user._id,
            pointsClaimed: randomPoints,
        });
        await historyRecord.save();

        // Broadcast the updated leaderboard to all clients
        io.emit('leaderboardUpdate', await getLeaderboard());

        res.json({
            message: `Awarded ${randomPoints} points to ${user.name}`,
            pointsAwarded: randomPoints,
            user: user,
        });
    } catch (error) {
        console.error('Claim error:', error);
        res.status(500).json({ message: 'Error claiming points' });
    }
});

// --- Socket.IO Connection ---
io.on('connection', async (socket) => {
    console.log('A user connected:', socket.id);

    // Send the initial leaderboard data to the newly connected client
    socket.emit('leaderboardUpdate', await getLeaderboard());

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// --- Server Startup ---
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// --- Database Seeding (for initial users) ---
async function seedDatabase() {
    try {
        const userCount = await User.countDocuments();
        if (userCount === 0) {
            console.log('No users found, seeding database...');
            const initialUsers = ['Rahul', 'Kamal', 'Sanak', 'Priya', 'Amit', 'Sunita', 'Vikram', 'Anjali', 'Deepak', 'Meera'];
            const usersToInsert = initialUsers.map(name => ({ name }));
            await User.insertMany(usersToInsert);
            console.log('Database seeded with 10 users.');
        }
    } catch (error) {
        // This function runs on startup, so it can't send a response.
        // We just log the error to the console.
        console.error('Error seeding database:', error);
    }
}
