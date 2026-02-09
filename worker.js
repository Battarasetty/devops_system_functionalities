require('dotenv').config();
const redis = require('redis');

const redisClient = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379
    }
});

redisClient.connect().then(() => console.log('Worker connected to Redis'));

async function processTask(task) {
    console.log(`🚀 Worker processing task: ${task.taskId} - ${task.message}`);
    // Simulate task processing time
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
    // Update task status
    await redisClient.set(`task_status:${task.taskId}`, 'completed');
    console.log(`✅ Worker completed task: ${task.taskId}`);
}

async function startWorker() {
    console.log('Worker started, waiting for tasks...');
    while (true) {
        try {
            const res = await redisClient.brPop('task_queue', 0); // block until task available
            const task = JSON.parse(res.element);
            await processTask(task);
        } catch (err) {
            console.error('Worker error:', err);
        }
    }
}

startWorker();
