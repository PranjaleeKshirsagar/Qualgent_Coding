const express = require('express');
const { queueService } = require('../services/queueService');
const { schedulerService } = require('../services/schedulerService');
const logger = require('../utils/logger');

const router = express.Router();

// GET /health - Basic health check
router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'QualGent Job Orchestrator',
    version: '1.0.0'
  });
});

// GET /health/detailed - Detailed health check with service status
router.get('/detailed', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'QualGent Job Orchestrator',
      version: '1.0.0',
      checks: {
        queue: 'unknown',
        scheduler: 'unknown',
        redis: 'unknown'
      }
    };

    // Check queue service
    try {
      const queueStats = await queueService.getQueueStats();
      health.checks.queue = 'healthy';
      health.queue_stats = queueStats;
    } catch (error) {
      health.checks.queue = 'unhealthy';
      health.queue_error = error.message;
      health.status = 'degraded';
    }

    // Check scheduler service
    try {
      const schedulerStats = await schedulerService.getSchedulerStats();
      health.checks.scheduler = 'healthy';
      health.scheduler_stats = schedulerStats;
    } catch (error) {
      health.checks.scheduler = 'unhealthy';
      health.scheduler_error = error.message;
      health.status = 'degraded';
    }

    // Check Redis connection
    try {
      if (queueService.redisClient && queueService.redisClient.isReady) {
        await queueService.redisClient.ping();
        health.checks.redis = 'healthy';
      } else {
        health.checks.redis = 'unhealthy';
        health.status = 'degraded';
      }
    } catch (error) {
      health.checks.redis = 'unhealthy';
      health.redis_error = error.message;
      health.status = 'degraded';
    }

    // Determine overall status
    const allHealthy = Object.values(health.checks).every(check => check === 'healthy');
    if (!allHealthy && health.status !== 'degraded') {
      health.status = 'unhealthy';
    }

    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(health);

  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      message: error.message
    });
  }
});

// GET /health/ready - Readiness probe
router.get('/ready', async (req, res) => {
  try {
    // Check if all critical services are ready
    const queueReady = queueService.jobQueue !== null;
    const schedulerReady = schedulerService.scheduler !== null;
    const redisReady = queueService.redisClient && queueService.redisClient.isReady;

    const ready = queueReady && schedulerReady && redisReady;

    if (ready) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        services: {
          queue: queueReady,
          scheduler: schedulerReady,
          redis: redisReady
        }
      });
    }
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// GET /health/live - Liveness probe
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router; 