const cron = require('node-cron');
const logger = require('../utils/logger');
const { queueService } = require('./queueService');
const { JOB_STATUS } = require('../models/Job');

class SchedulerService {
  constructor() {
    // Agents: Map<agentId, agentObj>
    this.agents = new Map(); // Each agent has: { id, status, devices: [deviceObj, ...] }
    this.devices = new Map(); // Flat device map for status endpoints (legacy)
    this.runningJobs = new Map(); // Currently running jobs
    this.scheduler = null;
  }

  async initialize() {
    try {
      // Initialize mock agents and devices
      this.initializeMockAgentsAndDevices();
      // Start the scheduler
      this.startScheduler();
      logger.info('Scheduler service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize scheduler service:', error);
      throw error;
    }
  }

  initializeMockAgentsAndDevices() {
    // Define five agents, each with their own devices
    const agentList = [
      {
        id: 'agent-1',
        status: 'online',
        devices: [
          { id: 'emulator-1', type: 'emulator', status: 'available', target: 'emulator', agent_id: 'agent-1' },
          { id: 'device-1', type: 'device', status: 'available', target: 'device', agent_id: 'agent-1' }
        ]
      },
      {
        id: 'agent-2',
        status: 'online',
        devices: [
          { id: 'emulator-2', type: 'emulator', status: 'available', target: 'emulator', agent_id: 'agent-2' },
          { id: 'device-2', type: 'device', status: 'available', target: 'device', agent_id: 'agent-2' },
          { id: 'browserstack-1', type: 'browserstack', status: 'available', target: 'browserstack', agent_id: 'agent-2' },
          { id: 'browserstack-2', type: 'browserstack', status: 'available', target: 'browserstack', agent_id: 'agent-2' }
        ]
      },
      {
        id: 'agent-3',
        status: 'online',
        devices: [
          { id: 'emulator-3', type: 'emulator', status: 'available', target: 'emulator', agent_id: 'agent-3' },
          { id: 'device-3', type: 'device', status: 'available', target: 'device', agent_id: 'agent-3' },
          { id: 'browserstack-3', type: 'browserstack', status: 'available', target: 'browserstack', agent_id: 'agent-3' }
        ]
      },
      {
        id: 'agent-4',
        status: 'online',
        devices: [
          { id: 'emulator-4', type: 'emulator', status: 'available', target: 'emulator', agent_id: 'agent-4' },
          { id: 'device-4', type: 'device', status: 'available', target: 'device', agent_id: 'agent-4' }
        ]
      },
      {
        id: 'agent-5',
        status: 'online',
        devices: [
          { id: 'emulator-5', type: 'emulator', status: 'available', target: 'emulator', agent_id: 'agent-5' },
          { id: 'device-5', type: 'device', status: 'available', target: 'device', agent_id: 'agent-5' },
          { id: 'browserstack-4', type: 'browserstack', status: 'available', target: 'browserstack', agent_id: 'agent-5' },
          { id: 'browserstack-5', type: 'browserstack', status: 'available', target: 'browserstack', agent_id: 'agent-5' }
        ]
      }
    ];
    // Populate agents map and flat device map
    this.agents.clear();
    this.devices.clear();
    for (const agent of agentList) {
      this.agents.set(agent.id, agent);
      for (const device of agent.devices) {
        this.devices.set(device.id, device);
      }
    }
    logger.info(`Initialized ${agentList.length} agents and ${this.devices.size} devices`);
  }

  startScheduler() {
    // Run scheduler every 5 seconds
    this.scheduler = cron.schedule('*/5 * * * * *', async () => {
      try {
        await this.processJobQueue();
      } catch (error) {
        logger.error('Error in scheduler loop:', error);
      }
    });

    logger.info('Job scheduler started (runs every 5 seconds)');
  }

  async processJobQueue() {
    try {
      // Get queue stats
      const stats = await queueService.getQueueStats();
      
      if (stats.waiting === 0) {
        return; // No jobs waiting
      }

      // Get job groups for efficient batching
      const jobGroups = await queueService.getJobGroups();
      
      for (const group of jobGroups) {
        if (group.status === 'queued' || group.status === 'running') {
          await this.processJobGroup(group);
        }
      }

    } catch (error) {
      logger.error('Error processing job queue:', error);
    }
  }

  // Find an available device for a target, and return both agent and device
  findAvailableAgentAndDevice(target) {
    for (const [agentId, agent] of this.agents.entries()) {
      if (agent.status !== 'online') continue;
      for (const device of agent.devices) {
        if (device.status === 'available' && device.target === target) {
          return { agent, device };
        }
      }
    }
    return null;
  }

  async processJobGroup(group) {
    try {
      const { group_id, target, job_count } = group;
      
      // First, check if there are any SCHEDULED jobs that need to be executed
      const scheduledJobs = await this.getScheduledJobsInGroup(group_id);
      if (scheduledJobs.length > 0) {
        // Find the agent that was assigned to these jobs
        const assignedAgentId = scheduledJobs[0].agent_id;
        const agent = this.agents.get(assignedAgentId);
        if (agent) {
          const device = agent.devices.find(d => d.id === scheduledJobs[0].device_id);
          if (device && device.status === 'available') {
            await this.assignAgentDeviceAndExecute(agent, device, scheduledJobs);
            return;
          }
        }
      }
      
      // If no scheduled jobs, look for queued jobs
      const found = this.findAvailableAgentAndDevice(target);
      if (!found) {
        logger.debug(`No available agent/device for target: ${target}`);
        return;
      }
      const { agent, device } = found;
      // Get jobs in this group
      const jobs = await this.getJobsInGroup(group_id);
      if (jobs.length === 0) {
        return;
      }
      // Assign device and start execution (pass agent info)
      await this.assignAgentDeviceAndExecute(agent, device, jobs);
    } catch (error) {
      logger.error(`Error processing job group ${group.group_id}:`, error);
    }
  }

  async getJobsInGroup(groupId) {
    const jobs = [];
    const [orgId, appVersionId, target] = groupId.split('_');
    
    // Get all jobs for this organization
    const orgJobs = await queueService.getJobs(orgId);
    
    // Filter jobs that match the group criteria and are available for processing
    for (const job of orgJobs) {
      if (job.app_version_id === appVersionId && 
          job.target === target && 
          job.status === JOB_STATUS.QUEUED) {
        jobs.push(job);
      }
    }
    
    // Sort by priority (high to low)
    jobs.sort((a, b) => {
      const priorityScores = { low: 1, medium: 2, high: 3 };
      return priorityScores[b.priority] - priorityScores[a.priority];
    });
    
    return jobs;
  }

  async getScheduledJobsInGroup(groupId) {
    const jobs = [];
    const [orgId, appVersionId, target] = groupId.split('_');
    
    // Get all jobs for this organization
    const orgJobs = await queueService.getJobs(orgId);
    
    // Filter jobs that match the group criteria and are scheduled
    for (const job of orgJobs) {
      if (job.app_version_id === appVersionId && 
          job.target === target && 
          job.status === JOB_STATUS.SCHEDULED) {
        jobs.push(job);
      }
    }
    
    // Sort by priority (high to low)
    jobs.sort((a, b) => {
      const priorityScores = { low: 1, medium: 2, high: 3 };
      return priorityScores[b.priority] - priorityScores[a.priority];
    });
    
    return jobs;
  }

  // Assign jobs to agent/device and execute
  async assignAgentDeviceAndExecute(agent, device, jobs) {
    try {
      // First, try to lock all jobs atomically
      const lockedJobs = [];
      
      for (const job of jobs) {
        const storedJob = await queueService.getJob(job.job_id);
        
        if (storedJob && storedJob.status === JOB_STATUS.QUEUED) {
          // Try to lock the job by updating its status to SCHEDULED
          storedJob.updateStatus(JOB_STATUS.SCHEDULED, { device_id: device.id, agent_id: agent.id });
          await queueService.updateJob(storedJob);
          lockedJobs.push(storedJob);
        } else if (storedJob && storedJob.status === JOB_STATUS.SCHEDULED) {
          // Job is already scheduled, check if it's assigned to this agent
          if (storedJob.agent_id === agent.id) {
            lockedJobs.push(storedJob);
          }
        } else if (storedJob && (storedJob.status === JOB_STATUS.COMPLETED || storedJob.status === JOB_STATUS.FAILED)) {
          // Skip completed or failed jobs
          logger.debug(`Skipping ${storedJob.status} job ${storedJob.job_id}`);
        }
      }
      
      if (lockedJobs.length === 0) {
        logger.debug(`No jobs could be locked for agent ${agent.id}, device ${device.id}`);
        return;
      }
      
      // Mark device as busy
      device.status = 'busy';
      device.current_jobs = lockedJobs.map(job => job.job_id);
      // Optionally, mark agent as busy if all its devices are busy
      agent.status = agent.devices.every(d => d.status === 'busy') ? 'busy' : 'online';
      logger.info(`Agent ${agent.id} (device ${device.id}) assigned to ${lockedJobs.length} jobs`);
      
      // Simulate test execution
      await this.executeTests(agent, device, lockedJobs);
    } catch (error) {
      logger.error(`Error assigning agent/device ${agent.id}/${device.id}:`, error);
      // Mark device as available again
      device.status = 'available';
      device.current_jobs = [];
      agent.status = 'online';
    }
  }

  // Update executeTests to include agent
  async executeTests(agent, device, jobs) {
    try {
      logger.info(`Starting test execution on agent ${agent.id}, device ${device.id} for ${jobs.length} jobs`);
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        // Update job status to running
        const storedJob = await queueService.getJob(job.job_id);
        if (storedJob) {
          storedJob.updateStatus(JOB_STATUS.RUNNING, { device_id: device.id, agent_id: agent.id });
          await queueService.updateJob(storedJob);
        }
        // Simulate test execution with progress
        await this.simulateTestExecution(job, agent, device);
        // Update progress - but only if job is still running (not completed/failed)
        const currentJob = await queueService.getJob(job.job_id);
        if (currentJob && currentJob.status === JOB_STATUS.RUNNING) {
          const progress = ((i + 1) / jobs.length) * 100;
          currentJob.progress = Math.round(progress);
          await queueService.updateJob(currentJob);
        }
      }
      // Mark device as available
      device.status = 'available';
      device.current_jobs = [];
      agent.status = agent.devices.every(d => d.status === 'available') ? 'online' : 'busy';
      logger.info(`Test execution completed on agent ${agent.id}, device ${device.id}`);
    } catch (error) {
      logger.error(`Error executing tests on agent ${agent.id}, device ${device.id}:`, error);
      device.status = 'available';
      device.current_jobs = [];
      agent.status = 'online';
      for (const job of jobs) {
        const storedJob = await queueService.getJob(job.job_id);
        if (storedJob) {
          storedJob.updateStatus(JOB_STATUS.FAILED, { error: error.message, agent_id: agent.id, device_id: device.id });
          await queueService.updateJob(storedJob);
        }
      }
    }
  }

  // Update simulateTestExecution to include agent
  async simulateTestExecution(job, agent, device) {
    // Double-check that the job is still in a valid state for execution
    const storedJob = await queueService.getJob(job.job_id);
    if (!storedJob || storedJob.status === JOB_STATUS.COMPLETED || storedJob.status === JOB_STATUS.FAILED) {
      logger.debug(`Skipping execution of ${storedJob?.status || 'unknown'} job ${job.job_id}`);
      return;
    }
    
    const executionTime = Math.random() * 4000 + 1000;
    logger.info(`Executing test ${job.job_id} on agent ${agent.id}, device ${device.id} (${executionTime}ms)`);
    await new Promise(resolve => setTimeout(resolve, executionTime));
    const success = Math.random() > 0.1;
    
    // Get the job again to ensure we have the latest state
    const currentJob = await queueService.getJob(job.job_id);
    logger.debug(`Before status update - Job ${job.job_id} status: ${currentJob?.status}`);
    
    if (currentJob && currentJob.status !== JOB_STATUS.COMPLETED && currentJob.status !== JOB_STATUS.FAILED) {
      if (success) {
        currentJob.updateStatus(JOB_STATUS.COMPLETED, {
          result: 'Test passed successfully',
          device_id: device.id,
          agent_id: agent.id
        });
        logger.info(`Test ${job.job_id} completed successfully`);
        logger.debug(`After status update - Job ${job.job_id} status: ${currentJob.status}`);
      } else {
        currentJob.updateStatus(JOB_STATUS.FAILED, {
          error: 'Test failed during execution',
          device_id: device.id,
          agent_id: agent.id
        });
        logger.error(`Test ${job.job_id} failed`);
        logger.debug(`After status update - Job ${job.job_id} status: ${currentJob.status}`);
      }
      await queueService.updateJob(currentJob);
      logger.debug(`Job ${job.job_id} status update saved to Redis`);
    } else {
      logger.debug(`Job ${job.job_id} status update skipped - current status: ${currentJob?.status}`);
    }
  }
}

const schedulerService = new SchedulerService();

async function initializeScheduler() {
  await schedulerService.initialize();
}

module.exports = {
  schedulerService,
  initializeScheduler
};