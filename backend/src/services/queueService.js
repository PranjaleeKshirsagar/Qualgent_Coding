const Queue = require('bull');
const Redis = require('redis');
const logger = require('../utils/logger');
const { Job, JOB_STATUS } = require('../models/Job');

class QueueService {
  constructor() {
    this.redisClient = null;
    this.jobQueue = null;
    // Remove in-memory jobStore - will use Redis instead
  }

  async initialize() {
    try {
      // Initialize Redis client
      this.redisClient = Redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis server refused connection');
            return new Error('Redis server refused connection');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            logger.error('Redis retry time exhausted');
            return new Error('Redis retry time exhausted');
          }
          if (options.attempt > 10) {
            logger.error('Redis max retry attempts reached');
            return new Error('Redis max retry attempts reached');
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      await this.redisClient.connect();
      logger.info('Redis client connected');

      // Initialize Bull queue - only for job processing coordination, not storage
      this.jobQueue = new Queue('qgjob-queue', {
        redis: {
          url: process.env.REDIS_URL || 'redis://localhost:6379'
        },
        defaultJobOptions: {
          removeOnComplete: 0,   // Don't keep completed jobs in Bull queue
          removeOnFail: 0,       // Don't keep failed jobs in Bull queue
          attempts: 1,           // No retries in Bull queue (we handle retries ourselves)
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      });

      // Set up queue event handlers
      this.setupQueueEventHandlers();

      // Clear any existing Bull queue jobs to prevent conflicts
      await this.jobQueue.empty();

      // Startup recovery logic - reset jobs stuck in "running" state
      await this.performStartupRecovery();

      logger.info('Queue service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize queue service:', error);
      throw error;
    }
  }

  setupQueueEventHandlers() {
    // Minimal event handlers for Bull queue - we manage job state ourselves
    this.jobQueue.on('completed', (job, result) => {
      const jobData = job.data;
      logger.debug(`Bull queue job ${jobData.job_id} completed`);
    });

    this.jobQueue.on('failed', (job, err) => {
      const jobData = job.data;
      logger.debug(`Bull queue job ${jobData.job_id} failed: ${err.message}`);
    });

    this.jobQueue.on('active', (job) => {
      const jobData = job.data;
      logger.debug(`Bull queue job ${jobData.job_id} started processing`);
    });
  }

  // Startup recovery logic
  async performStartupRecovery() {
    try {
      logger.info('Performing startup recovery...');
      
      // Scan Redis for jobs stuck in "running" state
      const pattern = `job:*`;
      const keys = await this.redisClient.keys(pattern);
      let recoveredJobs = 0;
      
      for (const key of keys) {
        const jobDataStr = await this.redisClient.get(key);
        if (jobDataStr) {
          const jobData = JSON.parse(jobDataStr);
          
          // Check if job is stuck in "running" or "scheduled" state
          if (jobData.status === JOB_STATUS.RUNNING || jobData.status === JOB_STATUS.SCHEDULED) {
            logger.warn(`Found job ${jobData.job_id} stuck in ${jobData.status} state, resetting to queued`);
            
            // Create job object and reset status
            const job = Job.create(jobData);
            job.updateStatus(JOB_STATUS.QUEUED, { 
              error: 'Job reset due to server restart',
              agent_id: null,
              device_id: null
            });
            
            // Update job in Redis
            await this.storeJob(job);
            
            recoveredJobs++;
          }
        }
      }
      
      if (recoveredJobs > 0) {
        logger.info(`Startup recovery completed: ${recoveredJobs} jobs reset to queued state`);
      } else {
        logger.info('Startup recovery completed: no stuck jobs found');
      }
      
    } catch (error) {
      logger.error('Error during startup recovery:', error);
      // Don't throw error - allow service to start even if recovery fails
    }
  }

  // Redis job storage methods
  async storeJob(job) {
    try {
      const jobKey = `job:${job.job_id}`;
      const jobData = JSON.stringify(job.toJSON());
      await this.redisClient.set(jobKey, jobData);
      logger.debug(`Job ${job.job_id} stored in Redis with status: ${job.status}`);
      
      // Verify the data was stored correctly
      const storedData = await this.redisClient.get(jobKey);
      const storedJob = JSON.parse(storedData);
      logger.debug(`Verification - Job ${job.job_id} stored in Redis with status: ${storedJob.status}`);
    } catch (error) {
      logger.error(`Failed to store job ${job.job_id} in Redis:`, error);
      throw error;
    }
  }

  async getJob(jobId) {
    try {
      const jobKey = `job:${jobId}`;
      const jobData = await this.redisClient.get(jobKey);
      if (!jobData) {
        logger.debug(`Job ${jobId} not found in Redis`);
        return null;
      }
      const jobObj = JSON.parse(jobData);
      logger.debug(`Retrieved job ${jobId} from Redis with status: ${jobObj.status}`);
      const job = Job.create(jobObj);
      logger.debug(`Created job object with status: ${job.status}`);
      logger.debug(`Returning job ${jobId} with status: ${job.status}`);
      return job;
    } catch (error) {
      logger.error(`Failed to get job ${jobId} from Redis:`, error);
      return null;
    }
  }

  async updateJob(job) {
    try {
      await this.storeJob(job);
      logger.debug(`Job ${job.job_id} updated in Redis`);
    } catch (error) {
      logger.error(`Failed to update job ${job.job_id} in Redis:`, error);
      throw error;
    }
  }

  // Job deduplication
  async findDuplicateJob(jobData) {
    try {
      // Check for existing job with same org_id, app_version_id, test_path, and target
      const pattern = `job:*`;
      const keys = await this.redisClient.keys(pattern);
      
      for (const key of keys) {
        const jobDataStr = await this.redisClient.get(key);
        if (jobDataStr) {
          const existingJob = JSON.parse(jobDataStr);
          if (existingJob.org_id === jobData.org_id &&
              existingJob.app_version_id === jobData.app_version_id &&
              existingJob.test_path === jobData.test_path &&
              existingJob.target === jobData.target &&
              (existingJob.status === JOB_STATUS.QUEUED || 
               existingJob.status === JOB_STATUS.SCHEDULED || 
               existingJob.status === JOB_STATUS.RUNNING)) {
            return Job.create(existingJob);
          }
        }
      }
      return null;
    } catch (error) {
      logger.error('Error checking for duplicate jobs:', error);
      return null;
    }
  }

  async addJob(jobData) {
    try {
      // Check for duplicate job first
      const duplicateJob = await this.findDuplicateJob(jobData);
      if (duplicateJob) {
        logger.info(`Duplicate job detected: ${duplicateJob.job_id}`);
        return {
          job_id: duplicateJob.job_id,
          status: duplicateJob.status,
          message: 'Job already exists with same parameters'
        };
      }

      // Create job instance
      const job = Job.create(jobData);
      
      // Store job in Redis
      await this.storeJob(job);
      
      logger.info(`Job ${job.job_id} added to queue with priority ${job.priority}`);
      
      return {
        job_id: job.job_id,
        status: job.status,
        message: 'Job queued successfully'
      };

    } catch (error) {
      logger.error('Failed to add job to queue:', error);
      throw error;
    }
  }

  async getJobs(orgId, status = null) {
    try {
      const pattern = `job:*`;
      const keys = await this.redisClient.keys(pattern);
      const jobs = [];
      
      for (const key of keys) {
        const jobDataStr = await this.redisClient.get(key);
        if (jobDataStr) {
          const jobData = JSON.parse(jobDataStr);
          if (jobData.org_id === orgId && (!status || jobData.status === status)) {
            jobs.push(Job.create(jobData));
          }
        }
      }
      
      return jobs;
    } catch (error) {
      logger.error(`Failed to get jobs for org ${orgId}:`, error);
      return [];
    }
  }

  async getJobGroups() {
    try {
      const groups = new Map();
      
      // Scan Redis for all jobs
      const pattern = `job:*`;
      const keys = await this.redisClient.keys(pattern);
      
      for (const key of keys) {
        const jobDataStr = await this.redisClient.get(key);
        if (jobDataStr) {
          const jobData = JSON.parse(jobDataStr);
          const job = Job.create(jobData);
          
          // Only include jobs that are not completed or failed
          if (job.status !== JOB_STATUS.COMPLETED && job.status !== JOB_STATUS.FAILED) {
            const groupId = job.getGroupId();
            
            if (!groups.has(groupId)) {
              const [orgId, appVersionId, target] = groupId.split('_');
              groups.set(groupId, {
                group_id: groupId,
                org_id: orgId,
                app_version_id: appVersionId,
                target: target,
                jobs: []
              });
            }
            
            groups.get(groupId).jobs.push(job);
          }
        }
      }
      
      // Convert to array format and calculate stats
      const result = [];
      for (const [groupId, groupData] of groups.entries()) {
        const jobs = groupData.jobs;
        
        // Sort jobs by priority (high to low)
        jobs.sort((a, b) => b.getPriorityScore() - a.getPriorityScore());
        
        result.push({
          group_id: groupData.group_id,
          org_id: groupData.org_id,
          app_version_id: groupData.app_version_id,
          target: groupData.target,
          job_count: jobs.length,
          status: this.getGroupStatus(jobs),
          oldest_job: jobs[0]?.timestamp,
          newest_job: jobs[jobs.length - 1]?.timestamp
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Error getting job groups:', error);
      return [];
    }
  }

  getGroupStatus(jobs) {
    if (jobs.some(job => job.status === JOB_STATUS.RUNNING)) {
      return 'running';
    } else if (jobs.some(job => job.status === JOB_STATUS.FAILED)) {
      return 'failed';
    } else if (jobs.every(job => job.status === JOB_STATUS.COMPLETED)) {
      return 'completed';
    } else {
      return 'queued';
    }
  }

  async getQueueStats() {
    try {
      // Count jobs by status from Redis
      const pattern = `job:*`;
      const keys = await this.redisClient.keys(pattern);
      let waiting = 0, active = 0, completed = 0, failed = 0;
      
      for (const key of keys) {
        const jobDataStr = await this.redisClient.get(key);
        if (jobDataStr) {
          const jobData = JSON.parse(jobDataStr);
          switch (jobData.status) {
            case JOB_STATUS.QUEUED:
            case JOB_STATUS.SCHEDULED:
              waiting++;
              break;
            case JOB_STATUS.RUNNING:
              active++;
              break;
            case JOB_STATUS.COMPLETED:
              completed++;
              break;
            case JOB_STATUS.FAILED:
              failed++;
              break;
          }
        }
      }
      
      // Count active groups (groups with non-completed jobs)
      const jobGroups = await this.getJobGroups();
      
      return {
        waiting,
        active,
        completed,
        failed,
        total: keys.length,
        groups: jobGroups.length
      };
    } catch (error) {
      logger.error('Failed to get queue stats:', error);
      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        total: 0,
        groups: 0
      };
    }
  }

  async cancelJob(jobId) {
    try {
      const job = await this.getJob(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED) {
        throw new Error('Cannot cancel completed or failed job');
      }

      job.updateStatus(JOB_STATUS.CANCELLED);
      await this.updateJob(job);

      // Remove from Bull queue if still there
      try {
        const queueJob = await this.jobQueue.getJob(jobId);
        if (queueJob) {
          await queueJob.remove();
        }
      } catch (error) {
        logger.warn(`Could not remove job ${jobId} from Bull queue:`, error);
      }

      return {
        job_id: jobId,
        status: JOB_STATUS.CANCELLED,
        message: 'Job cancelled successfully'
      };

    } catch (error) {
      logger.error(`Failed to cancel job ${jobId}:`, error);
      throw error;
    }
  }

  async retryJob(jobId) {
    try {
      const job = await this.getJob(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      if (!job.canRetry()) {
        throw new Error('Job cannot be retried');
      }

      job.incrementRetry();
      await this.updateJob(job);

      // Add back to queue
      await this.jobQueue.add('process-test', job.toJSON(), {
        priority: job.getPriorityScore(),
        jobId: job.job_id,
        delay: 0,
        attempts: job.max_retries
      });

      return {
        job_id: jobId,
        status: job.status,
        message: 'Job queued for retry'
      };

    } catch (error) {
      logger.error(`Failed to retry job ${jobId}:`, error);
      throw error;
    }
  }

  async cleanup() {
    try {
      if (this.redisClient) {
        await this.redisClient.quit();
      }
      if (this.jobQueue) {
        await this.jobQueue.close();
      }
      logger.info('Queue service cleaned up');
    } catch (error) {
      logger.error('Error during queue cleanup:', error);
    }
  }
}

// Singleton instance
const queueService = new QueueService();

async function initializeQueues() {
  await queueService.initialize();
}

module.exports = {
  queueService,
  initializeQueues
}; 