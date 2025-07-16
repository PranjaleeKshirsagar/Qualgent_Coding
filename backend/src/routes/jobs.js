const express = require('express');
const { queueService } = require('../services/queueService');
const { schedulerService } = require('../services/schedulerService');
const { Job } = require('../models/Job');
const logger = require('../utils/logger');

const router = express.Router();

// POST /api/jobs - Submit a new job
router.post('/', async (req, res) => {
  try {
    const jobData = req.body;
    
    // Validate job data
    const { error } = Job.validate(jobData);
    if (error) {
      return res.status(400).json({
        error: 'Invalid job data',
        details: error.details[0].message
      });
    }

    // Add job to queue
    const result = await queueService.addJob(jobData);
    
    logger.info(`Job submitted: ${result.job_id}`);
    
    res.status(201).json(result);
    
  } catch (error) {
    logger.error('Error submitting job:', error);
    res.status(500).json({
      error: 'Failed to submit job',
      message: error.message
    });
  }
});

// GET /api/jobs/:jobId - Get job status
router.get('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await queueService.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        job_id: jobId
      });
    }
    
    // Add debug logging to see what's being returned
    logger.debug(`Returning job ${jobId} with status: ${job.status}`);
    
    res.json(job);
    
  } catch (error) {
    logger.error(`Error getting job ${req.params.jobId}:`, error);
    res.status(500).json({
      error: 'Failed to get job',
      message: error.message
    });
  }
});

// GET /api/jobs - List jobs (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { org_id, status } = req.query;
    
    if (!org_id) {
      return res.status(400).json({
        error: 'org_id parameter is required'
      });
    }
    
    const jobs = await queueService.getJobs(org_id, status);
    
    res.json({
      org_id,
      status_filter: status || 'all',
      count: jobs.length,
      jobs
    });
    
  } catch (error) {
    logger.error('Error listing jobs:', error);
    res.status(500).json({
      error: 'Failed to list jobs',
      message: error.message
    });
  }
});

// DELETE /api/jobs/:jobId - Cancel a job
router.delete('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const result = await queueService.cancelJob(jobId);
    
    logger.info(`Job cancelled: ${jobId}`);
    
    res.json(result);
    
  } catch (error) {
    logger.error(`Error cancelling job ${req.params.jobId}:`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Job not found',
        job_id: req.params.jobId
      });
    }
    
    res.status(500).json({
      error: 'Failed to cancel job',
      message: error.message
    });
  }
});

// POST /api/jobs/:jobId/retry - Retry a failed job
router.post('/:jobId/retry', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const result = await queueService.retryJob(jobId);
    
    logger.info(`Job retried: ${jobId}`);
    
    res.json(result);
    
  } catch (error) {
    logger.error(`Error retrying job ${req.params.jobId}:`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Job not found',
        job_id: req.params.jobId
      });
    }
    
    if (error.message.includes('cannot be retried')) {
      return res.status(400).json({
        error: 'Job cannot be retried',
        message: error.message
      });
    }
    
    res.status(500).json({
      error: 'Failed to retry job',
      message: error.message
    });
  }
});

// GET /api/jobs/groups - Get job groups
router.get('/groups', async (req, res) => {
  try {
    const groups = await queueService.getJobGroups();
    
    res.json({
      count: groups.length,
      groups
    });
    
  } catch (error) {
    logger.error('Error getting job groups:', error);
    res.status(500).json({
      error: 'Failed to get job groups',
      message: error.message
    });
  }
});

// GET /api/jobs/stats - Get queue statistics
router.get('/stats', async (req, res) => {
  try {
    const queueStats = await queueService.getQueueStats();
    const schedulerStats = await schedulerService.getSchedulerStats();
    
    res.json({
      queue: queueStats,
      scheduler: schedulerStats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error getting stats:', error);
    res.status(500).json({
      error: 'Failed to get statistics',
      message: error.message
    });
  }
});

// GET /api/jobs/devices - Get device status
router.get('/devices', async (req, res) => {
  try {
    const devices = schedulerService.getDeviceStatus();
    
    res.json({
      count: devices.length,
      devices
    });
    
  } catch (error) {
    logger.error('Error getting device status:', error);
    res.status(500).json({
      error: 'Failed to get device status',
      message: error.message
    });
  }
});

module.exports = router; 