const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');

// Job status enum
const JOB_STATUS = {
  QUEUED: 'queued',
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'retrying'
};

// Priority enum
const PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

// Target enum
const TARGET = {
  EMULATOR: 'emulator',
  DEVICE: 'device',
  BROWSERSTACK: 'browserstack'
};

// Job validation schema
const jobSchema = Joi.object({
  org_id: Joi.string().required().min(1).max(100),
  app_version_id: Joi.string().required().min(1).max(100),
  test_path: Joi.string().required().min(1),
  priority: Joi.string().valid(...Object.values(PRIORITY)).default(PRIORITY.MEDIUM),
  target: Joi.string().valid(...Object.values(TARGET)).default(TARGET.EMULATOR),
  timestamp: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()).allow(null).default(() => new Date().toISOString()),
  job_id: Joi.string().default(() => `job_${Date.now()}_${uuidv4().substr(0, 8)}`),
  // Allow execution state fields for existing jobs
  status: Joi.string().valid(...Object.values(JOB_STATUS)).optional(),
  progress: Joi.number().min(0).max(100).optional(),
  result: Joi.any().optional(),
  error: Joi.any().optional(),
  retry_count: Joi.number().min(0).optional(),
  max_retries: Joi.number().min(1).optional(),
  started_at: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()).allow(null).optional(),
  completed_at: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()).allow(null).optional(),
  device_id: Joi.string().allow(null).optional(),
  agent_id: Joi.string().allow(null).optional(),
  group_id: Joi.string().allow(null).optional()
});

class Job {
  constructor(data) {
    const { error, value } = jobSchema.validate(data);
    if (error) {
      throw new Error(`Job validation failed: ${error.details[0].message}`);
    }

    this.org_id = value.org_id;
    this.app_version_id = value.app_version_id;
    this.test_path = value.test_path;
    this.priority = value.priority;
    this.target = value.target;
    this.timestamp = value.timestamp;
    this.job_id = value.job_id;
    
    // Job execution state
    this.status = value.status || JOB_STATUS.QUEUED;
    this.progress = value.progress || 0;
    this.result = value.result || null;
    this.error = value.error || null;
    this.retry_count = value.retry_count || 0;
    this.max_retries = value.max_retries || 3;
    this.started_at = value.started_at || null;
    this.completed_at = value.completed_at || null;
    this.device_id = value.device_id || null;
    this.agent_id = value.agent_id || null;
    this.group_id = value.group_id || null; // For grouping by app_version_id
  }

  // Create a job from raw data
  static create(data) {
    return new Job(data);
  }

  // Validate job data
  static validate(data) {
    return jobSchema.validate(data);
  }

  // Update job status
  updateStatus(status, additionalData = {}) {
    if (!Object.values(JOB_STATUS).includes(status)) {
      throw new Error(`Invalid job status: ${status}`);
    }

    this.status = status;
    
    if (status === JOB_STATUS.RUNNING && !this.started_at) {
      this.started_at = new Date().toISOString();
    }
    
    if (status === JOB_STATUS.COMPLETED || status === JOB_STATUS.FAILED) {
      this.completed_at = new Date().toISOString();
    }

    // Update additional fields
    Object.assign(this, additionalData);
  }

  // Increment retry count
  incrementRetry() {
    this.retry_count++;
    if (this.retry_count > this.max_retries) {
      this.updateStatus(JOB_STATUS.FAILED, { 
        error: `Max retries (${this.max_retries}) exceeded` 
      });
    } else {
      this.updateStatus(JOB_STATUS.RETRYING);
    }
  }

  // Check if job can be retried
  canRetry() {
    return this.retry_count < this.max_retries && 
           (this.status === JOB_STATUS.FAILED || this.status === JOB_STATUS.RETRYING);
  }

  // Get job priority score for sorting
  getPriorityScore() {
    const priorityScores = {
      [PRIORITY.LOW]: 1,
      [PRIORITY.MEDIUM]: 2,
      [PRIORITY.HIGH]: 3
    };
    return priorityScores[this.priority] || 1;
  }

  // Create group ID for batching
  getGroupId() {
    return `${this.org_id}_${this.app_version_id}_${this.target}`;
  }

  // Convert to JSON
  toJSON() {
    return {
      job_id: this.job_id,
      org_id: this.org_id,
      app_version_id: this.app_version_id,
      test_path: this.test_path,
      priority: this.priority,
      target: this.target,
      status: this.status,
      progress: this.progress,
      result: this.result,
      error: this.error,
      retry_count: this.retry_count,
      timestamp: this.timestamp,
      started_at: this.started_at,
      completed_at: this.completed_at,
      device_id: this.device_id,
      agent_id: this.agent_id,
      group_id: this.group_id
    };
  }

  // Create summary for listing
  toSummary() {
    return {
      job_id: this.job_id,
      org_id: this.org_id,
      app_version_id: this.app_version_id,
      test_path: this.test_path,
      status: this.status,
      priority: this.priority,
      target: this.target,
      timestamp: this.timestamp,
      progress: this.progress
    };
  }
}

module.exports = {
  Job,
  JOB_STATUS,
  PRIORITY,
  TARGET,
  jobSchema
}; 