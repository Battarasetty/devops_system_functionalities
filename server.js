require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const redis = require('redis');

const app = express();
app.use(express.json());

// IMPORTANT for correct req.ip behind proxies
app.set('trust proxy', true);

/* ===================== STARTUP DEBUG ===================== */
console.log('🚀 Server starting');
console.log('SERVER_NAME:', process.env.SERVER_NAME);
console.log('PORT:', process.env.PORT);

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

// ===================== QUEUE ROUTE =====================
app.post('/queue', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });

        const taskId = `task_${Date.now()}`; // unique id for task

        // Push task to Redis list (queue)
        await redisClient.lPush('task_queue', JSON.stringify({ taskId, message, createdAt: Date.now() }));

        // Set initial status
        await redisClient.set(`task_status:${taskId}`, 'queued');

        console.log(`✅ Task queued: ${taskId} - ${message}`);
        res.json({ status: 'queued', taskId, message });
    } catch (err) {
        console.error('Queue error:', err);
        res.status(500).json({ error: 'Failed to queue task' });
    }
});

// ===================== TASK STATUS ROUTE =====================
app.get('/task-status/:id', async (req, res) => {
    try {
        const taskId = req.params.id;
        const status = await redisClient.get(`task_status:${taskId}`);

        if (!status) return res.status(404).json({ error: 'Task not found' });

        res.json({ taskId, status });
    } catch (err) {
        console.error('Task status error:', err);
        res.status(500).json({ error: 'Failed to get task status' });
    }
});


/* ===================== SERVER ===================== */
app.listen(process.env.PORT, () => {
    console.log(`✅ Server running on port ${process.env.PORT}`);
});
