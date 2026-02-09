require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const redis = require('redis');

const USE_CACHE = process.env.USE_CACHE === 'true';

const app = express();
app.use(express.json());

// IMPORTANT for correct req.ip behind proxies
app.set('trust proxy', true);

/* ===================== STARTUP DEBUG ===================== */
console.log('🚀 Server starting');
console.log('SERVER_NAME:', process.env.SERVER_NAME);
console.log('PORT:', process.env.PORT);

/* ===================== LOGGING ===================== */
app.use((req, res, next) => {
    console.log(
        `Request ${req.method} ${req.url} handled by ${process.env.SERVER_NAME}`
    );
    next();
});

/* ===================== ONE-TIME DELAY TEST ===================== */
/*
   Only SERVER_NAME=node-server-2
   Only FIRST request
   Delay = 40 seconds
*/
let firstRequestHandled = false;

app.use(async (req, res, next) => {
    if (
        process.env.SERVER_NAME === 'node-server-2' &&
        !firstRequestHandled
    ) {
        firstRequestHandled = true;
        console.log('⏳ FIRST request delay on node-server-2 (40s)');
        await new Promise(resolve => setTimeout(resolve, 40000));
        console.log('✅ Delay finished on node-server-2');
    }
    next();
});

/* ===================== MongoDB ===================== */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('Mongo error:', err));

/* ===================== Redis ===================== */
const redisClient = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
});

redisClient.connect()
    .then(() => console.log('Redis connected'))
    .catch(err => console.error('Redis error:', err));

/* ===================== RATE LIMITER ===================== */
const rateLimiter = async (req, res, next) => {
    try {
        const ip = req.ip;
        const key = `rate:${ip}`;
        const LIMIT = 5;
        const WINDOW = 60;

        const current = await redisClient.incr(key);

        if (current === 1) {
            await redisClient.expire(key, WINDOW);
        }

        if (current > LIMIT) {
            return res.status(429).json({
                msg: 'Too many requests. Try again later.'
            });
        }

        next();
    } catch (err) {
        console.error('Rate limiter error:', err);
        next(); // fail-open
    }
};

/* ===================== Schema ===================== */
const UserSchema = new mongoose.Schema({
    name: String,
    email: String
});
const User = mongoose.model('User', UserSchema);

/* ===================== ROUTES ===================== */

// Health Check
app.get('/health', async (req, res) => {
    try {
        const mongoState = mongoose.connection.readyState;
        const redisState = redisClient.isReady;

        const status = {
            server: 'up',
            mongo: mongoState === 1 ? 'connected' : 'down',
            redis: redisState ? 'connected' : 'down',
            handledBy: process.env.SERVER_NAME,
            uptime: process.uptime()
        };

        const healthy = mongoState === 1 && redisState;

        res.status(healthy ? 200 : 500).json(status);
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// CREATE USER
app.post('/users', rateLimiter, async (req, res) => {
    try {
        const user = await User.create(req.body);
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'User creation failed' });
    }
});

// GET USER (WITH REDIS CACHE)
app.get('/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const key = `user:${userId}`;

        if (!USE_CACHE) {
            console.log('CACHE OFF → DB');
            const user = await User.findById(userId);
            if (!user) return res.status(404).send('Not found');
            return res.json(user);
        }

        const cached = await redisClient.get(key);
        if (cached) {
            console.log('Cache HIT');
            return res.json(JSON.parse(cached));
        }

        console.log('Cache MISS → DB');
        const user = await User.findById(userId);
        if (!user) return res.status(404).send('Not found');

        await redisClient.setEx(key, 60, JSON.stringify(user));
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Fetch failed' });
    }
});

/* ===================== SERVER ===================== */
app.listen(process.env.PORT, () => {
    console.log(`✅ Server running on port ${process.env.PORT}`);
});
