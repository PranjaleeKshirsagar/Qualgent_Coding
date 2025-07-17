# QGJob CLI - QualGent Job Orchestrator

A command-line interface tool for submitting and managing AppWright test jobs across local devices, emulators, and BrowserStack.

## Features

- Submit test jobs with automatic grouping by app version
- Check job status and progress
- List jobs by organization
- Default values for priority and target with override options
- Comprehensive error handling and validation
- Job persistence and crash recovery
- Job deduplication to prevent duplicate submissions

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CLI Tool      │    │   Backend API   │    │   Redis Storage │
│   (qgjob)       │───▶│   (Express)     │───▶│   (Custom)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   Scheduler     │
                       │   (Cron Jobs)   │
                       └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   Agent Pool    │
                       │  (5 Agents with │
                       │   15 Devices)   │
                       └─────────────────┘
```

### Storage Architecture
- **Custom Redis Storage**: Job state managed via `job:${jobId}` keys
- **Bull Queue**: Used only for job coordination, not storage
- **Atomic Updates**: Job status updates are atomic to prevent race conditions
- **Verification Logging**: All Redis operations are verified and logged

## Setup Instructions

### Prerequisites
- Node.js 14.0.0 or higher
- Redis server running
- npm or yarn

### Backend Setup

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

4. **Start Redis server:**
   ```bash
   # On Windows (if using WSL or Docker)
   docker run -d -p 6379:6379 redis:alpine
   
   # On macOS
   brew install redis
   brew services start redis
   
   # On Linux
   sudo apt-get install redis-server
   sudo systemctl start redis
   ```

5. **Start the backend service:**
   ```bash
   npm start
   ```

### CLI Setup

1. **Install CLI dependencies:**
   ```bash
   npm install
   ```

2. **Make CLI executable:**
   ```bash
   chmod +x qgjob.js
   ```

3. **Install globally (optional):**
   ```bash
   npm install -g .
   ```

## How Grouping/Scheduling Works

### Job Grouping Logic
Jobs are automatically grouped by:
- `org_id` (organization identifier)
- `app_version_id` (app version to avoid reinstalling)
- `target` (emulator/device/browserstack)

**Example:**
- Job 1: `org_id=qualgent, app_version_id=xyz123, target=emulator`
- Job 2: `org_id=qualgent, app_version_id=xyz123, target=emulator`
- Job 3: `org_id=qualgent, app_version_id=abc456, target=emulator`

**Result:** Jobs 1 & 2 are grouped together, Job 3 is in a separate group.

### Agent Assignment
- **5 agents** manage **15 devices** total
- Each agent has specific device types (emulator, device, browserstack)
- Jobs are assigned to agents with available devices matching the target
- All jobs in a group run on the same agent/device sequentially

### Agent/Device Distribution
| Agent ID | Devices Managed |
|----------|----------------|
| agent-1  | emulator-1, device-1 |
| agent-2  | emulator-2, device-2, browserstack-1, browserstack-2 |
| agent-3  | emulator-3, device-3, browserstack-3 |
| agent-4  | emulator-4, device-4 |
| agent-5  | emulator-5, device-5, browserstack-4, browserstack-5 |

## End-to-End Test Submission

### 1. Start the Backend Service
```bash
cd backend
npm start
```

### 2. Submit a Test Job
```bash
# Basic submission
qgjob submit --org-id=qualgent --app-version-id=xyz123 --test=tests/onboarding.spec.js

# With custom priority and target
qgjob submit --org-id=qualgent --app-version-id=xyz123 --test=tests/onboarding.spec.js --priority=high --target=device
```
<img src="images/job-status.png" alt="Job Status Check" style="width: 50%; max-width: 50px; height: auto;">


### 3. Check Job Status
```bash
qgjob status --job-id=<job_id_from_step_2>
```

### 4. List All Jobs
```bash
qgjob list --org-id=qualgent
```

### 5. Monitor Backend Logs
Watch the backend terminal for:
- Job assignment to agents
- Test execution progress
- Completion status

## Usage Examples

### Submit Jobs with Different Targets
```bash
# Emulator testing
qgjob submit --org-id=qualgent --app-version-id=xyz123 --test=tests/onboarding.spec.js --target=emulator

# Physical device testing
qgjob submit --org-id=qualgent --app-version-id=xyz123 --test=tests/onboarding.spec.js --target=device

# BrowserStack testing
qgjob submit --org-id=qualgent --app-version-id=xyz123 --test=tests/onboarding.spec.js --target=browserstack
```


### Check Job Status
```bash
qgjob status --job-id=job_1752698329771_ttq7uqgh7
```

### List Jobs by Status
```bash
# All jobs
qgjob list --org-id=qualgent

# Only running jobs
qgjob list --org-id=qualgent --status=running
```

## Default Values

When not specified, the CLI uses these defaults:
- **Priority**: `medium`
- **Target**: `emulator`

## Valid Values

### Priority Levels
- `low`
- `medium` (default)
- `high`

### Target Types
- `emulator` (default)
- `device`
- `browserstack`

## Environment Variables

- `QGJOB_BACKEND_URL`: Backend service URL (default: http://localhost:3000)

## Job Lifecycle

1. **Queued**: Job submitted and waiting in queue
2. **Scheduled**: Job assigned to agent and device
3. **Running**: Test execution in progress
4. **Completed**: Test finished successfully
5. **Failed**: Test failed (can be retried)
6. **Cancelled**: Job cancelled by user

### Status Update Reliability
- **Atomic Transitions**: Status changes are atomic and verified
- **Fresh State Retrieval**: Always get current job state before updates
- **Conditional Progress**: Progress updates only for running jobs
- **Conflict Prevention**: No race conditions between status updates

## Fault Tolerance Features

### Job Persistence
- Jobs stored in Redis survive server crashes
- Automatic recovery on server restart
- Job status preserved across restarts
- **Race Condition Prevention**: Fresh job state retrieved before updates

### Job Deduplication
- Prevents duplicate job submissions
- Returns existing job ID if duplicate detected
- Checks org_id, app_version_id, test_path, and target

### Startup Recovery
- Automatically resets jobs stuck in "running" state
- Re-queues jobs for retry after server restart
- Logs recovery actions for monitoring
- **Bull Queue Cleanup**: Clears any existing queue jobs to prevent conflicts

### Storage Reliability
- **Verification Logging**: All Redis operations are verified and logged
- **Atomic Updates**: Job status changes are atomic to prevent corruption
- **Conditional Updates**: Progress updates only occur for running jobs
- **Conflict Resolution**: Bull queue conflicts eliminated through custom storage

## API Endpoints

The CLI expects these endpoints from the backend service:

- `POST /api/jobs` - Submit a new job
- `GET /api/jobs/:jobId` - Get job status
- `GET /api/jobs?org_id=:orgId&status=:status` - List jobs

## Testing the System

### Test Job Persistence
1. Submit a job
2. Stop the server while job is running
3. Restart the server
4. Check job status - should be preserved

### Test Job Deduplication
1. Submit the same job twice
2. Second submission should return existing job ID

### Test Agent Assignment
1. Submit multiple jobs with different app_version_id
2. Check that jobs are assigned to different agents

### Test Status Reliability
1. Submit a job and monitor debug logs
2. Verify job status progresses correctly: queued → scheduled → running → completed
3. Check that completed status persists and doesn't revert to running
4. Confirm no infinite loops or race conditions

## Recent Improvements

### Race Condition Fix (v1.1)
- **Problem**: Job status updates were being overwritten by stale job objects
- **Solution**: Always retrieve fresh job state before updates
- **Result**: Reliable job status transitions and no infinite loops

### Bull Queue Optimization (v1.1)
- **Problem**: Bull queue was storing job data that conflicted with custom Redis storage
- **Solution**: Bull queue used only for coordination, not storage
- **Result**: Eliminated storage conflicts and improved reliability

### Enhanced Debug Logging (v1.1)
- **Problem**: Difficult to troubleshoot job state issues
- **Solution**: Added verification logging for all Redis operations
- **Result**: Better visibility into job lifecycle and easier debugging

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Ensure Redis server is running
   - Check `REDIS_URL` configuration

2. **Job Not Found**
   - Verify job ID is correct
   - Check if backend is running

3. **No Available Devices**
   - Check device status via API
   - Wait for devices to become available

### Debug Mode
```bash
# Backend debug with enhanced logging
NODE_ENV=development LOG_LEVEL=debug npm start

# CLI debug
DEBUG=* qgjob submit --org-id=test --app-version-id=test123 --test=example-test.js
```

### Enhanced Debug Features
- **Redis Verification**: All job storage operations are verified and logged
- **Status Tracking**: Detailed job status changes throughout lifecycle
- **Race Condition Detection**: Logs show when job state is retrieved and updated
- **Storage Conflicts**: Identifies and prevents Bull queue storage conflicts

## License

MIT 
