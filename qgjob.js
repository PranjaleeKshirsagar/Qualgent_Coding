#!/usr/bin/env node

const { Command } = require('commander');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const program = new Command();

// Default values
const DEFAULT_PRIORITY = 'medium';
const DEFAULT_TARGET = 'emulator';
const BACKEND_URL = process.env.QGJOB_BACKEND_URL || 'http://localhost:3000';

// Validate priority values
const VALID_PRIORITIES = ['low', 'medium', 'high'];
const VALID_TARGETS = ['emulator', 'device', 'browserstack'];

// Utility function to validate file exists
function validateTestFile(testPath) {
  if (!fs.existsSync(testPath)) {
    throw new Error(`Test file not found: ${testPath}`);
  }
  return true;
}

// Utility function to validate enum values
function validateEnum(value, validValues, fieldName) {
  if (!validValues.includes(value)) {
    throw new Error(`Invalid ${fieldName}: ${value}. Valid values: ${validValues.join(', ')}`);
  }
  return value;
}

// Utility function to generate job ID
function generateJobId() {
  return 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

program
  .name('qgjob')
  .description('QualGent Job Orchestrator CLI - Queue and manage AppWright tests')
  .version('1.0.0');

program
  .command('submit')
  .description('Submit a test job to the orchestrator')
  .requiredOption('--org-id <id>', 'Organization ID (e.g., qualgent)')
  .requiredOption('--app-version-id <id>', 'App version ID (e.g., xyz123)')
  .requiredOption('--test <path>', 'Path to test file (e.g., tests/onboarding.spec.js)')
  .option('--priority <level>', `Job priority (default: ${DEFAULT_PRIORITY})`, DEFAULT_PRIORITY)
  .option('--target <type>', `Target device type (default: ${DEFAULT_TARGET})`, DEFAULT_TARGET)
  .option('--backend-url <url>', 'Backend service URL', BACKEND_URL)
  .action(async (options) => {
    try {
      console.log('🚀 Submitting test job...\n');

      // Validate test file exists
      validateTestFile(options.test);

      // Validate priority and target values
      const priority = validateEnum(options.priority, VALID_PRIORITIES, 'priority');
      const target = validateEnum(options.target, VALID_TARGETS, 'target');

      // Construct job payload
      const payload = {
        org_id: options.orgId,
        app_version_id: options.appVersionId,
        test_path: path.resolve(options.test), // Convert to absolute path
        priority: priority,
        target: target,
        timestamp: new Date().toISOString(),
        job_id: generateJobId()
      };

      // Display job details
      console.log('📋 Job Details:');
      console.log(`   Organization ID: ${payload.org_id}`);
      console.log(`   App Version ID:  ${payload.app_version_id}`);
      console.log(`   Test File:       ${payload.test_path}`);
      console.log(`   Priority:        ${payload.priority}`);
      console.log(`   Target:          ${payload.target}`);
      console.log(`   Job ID:          ${payload.job_id}\n`);

      // Submit job to backend
      console.log('📡 Submitting to backend service...');
      const response = await axios.post(`${options.backendUrl}/api/jobs`, payload, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ Job submitted successfully!');
      console.log(`   Job ID: ${response.data.job_id || payload.job_id}`);
      console.log(`   Status: ${response.data.status || 'queued'}`);
      
      if (response.data.message) {
        console.log(`   Message: ${response.data.message}`);
      }

    } catch (error) {
      console.error('❌ Failed to submit job:');
      
      if (error.response) {
        // Backend error response
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Message: ${error.response.data?.message || error.message}`);
      } else if (error.code === 'ENOTFOUND') {
        console.error('   Backend service not found. Please check the backend URL.');
      } else if (error.code === 'ECONNREFUSED') {
        console.error('   Connection refused. Please ensure the backend service is running.');
      } else {
        console.error(`   ${error.message}`);
      }
      
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check the status of a submitted job')
  .requiredOption('--job-id <id>', 'Job ID to check status for')
  .option('--backend-url <url>', 'Backend service URL', BACKEND_URL)
  .action(async (options) => {
    try {
      console.log(`🔍 Checking status for job: ${options.jobId}\n`);

      const response = await axios.get(`${options.backendUrl}/api/jobs/${options.jobId}`, {
        timeout: 10000
      });

      const job = response.data;
      
      console.log('📊 Job Status:');
      console.log(`   Job ID:          ${job.job_id}`);
      console.log(`   Status:          ${job.status}`);
      console.log(`   Organization:    ${job.org_id}`);
      console.log(`   App Version:     ${job.app_version_id}`);
      console.log(`   Test File:       ${job.test_path}`);
      console.log(`   Priority:        ${job.priority}`);
      console.log(`   Target:          ${job.target}`);
      console.log(`   Created:         ${new Date(job.timestamp).toLocaleString()}`);
      
      if (job.progress) {
        console.log(`   Progress:        ${job.progress}%`);
      }
      
      if (job.result) {
        console.log(`   Result:          ${job.result}`);
      }
      
      if (job.error) {
        console.log(`   Error:           ${job.error}`);
      }

    } catch (error) {
      console.error('❌ Failed to get job status:');
      
      if (error.response?.status === 404) {
        console.error(`   Job not found: ${options.jobId}`);
      } else if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Message: ${error.response.data?.message || error.message}`);
      } else {
        console.error(`   ${error.message}`);
      }
      
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all jobs for an organization')
  .requiredOption('--org-id <id>', 'Organization ID')
  .option('--status <status>', 'Filter by status (queued/running/completed/failed)')
  .option('--backend-url <url>', 'Backend service URL', BACKEND_URL)
  .action(async (options) => {
    try {
      console.log(`📋 Listing jobs for organization: ${options.orgId}\n`);

      const params = new URLSearchParams({ org_id: options.orgId });
      if (options.status) {
        params.append('status', options.status);
      }

      const response = await axios.get(`${options.backendUrl}/api/jobs?${params}`, {
        timeout: 10000
      });

      const jobs = response.data;
      
      if (jobs.length === 0) {
        console.log('No jobs found.');
        return;
      }

      console.log(`Found ${jobs.length} job(s):\n`);
      
      jobs.forEach((job, index) => {
        console.log(`${index + 1}. Job ID: ${job.job_id}`);
        console.log(`   Status:      ${job.status}`);
        console.log(`   App Version: ${job.app_version_id}`);
        console.log(`   Test File:   ${job.test_path}`);
        console.log(`   Created:     ${new Date(job.timestamp).toLocaleString()}`);
        console.log('');
      });

    } catch (error) {
      console.error('❌ Failed to list jobs:');
      console.error(`   ${error.message}`);
      process.exit(1);
    }
  });

// Add help information
program.addHelpText('after', `

Examples:
  $ qgjob submit --org-id=qualgent --app-version-id=xyz123 --test=tests/onboarding.spec.js
  $ qgjob submit --org-id=qualgent --app-version-id=xyz123 --test=tests/onboarding.spec.js --priority=high --target=browserstack
  $ qgjob status --job-id=job_1234567890_abc123def
  $ qgjob list --org-id=qualgent --status=running

Environment Variables:
  QGJOB_BACKEND_URL    Backend service URL (default: http://localhost:3000)
`);

program.parse(); 