# QualGent Job Orchestrator Backend

A robust, scalable backend service for orchestrating AppWright test jobs across multiple device targets with intelligent job grouping and scheduling.

## Features

### Core Functionality
- **Job Queue Management**: Redis-based job queuing with Bull
- **Intelligent Grouping**: Groups jobs by `app_version_id` to minimize app installations
- **Device Orchestration**: Assigns jobs to available devices (emulators, physical devices, BrowserStack)
- **Priority Scheduling**: Supports low/medium/high priority job scheduling
- **Retry Logic**: Automatic retry with exponential backoff for failed jobs
- **Real-time Status Tracking**: Comprehensive job status and progress monitoring

### Advanced Features
- **Horizontal Scalability**: Designed for multi-instance deployment
- **Fault Tolerance**: Crash recovery and job deduplication
- **Monitoring**: Health checks, metrics, and detailed logging
- **RESTful API**: Complete API for job management
- **Modular Architecture**: Separated concerns for queueing, scheduling, and execution

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CLI Tool      │    │   Backend API   │    │   Redis Queue   │
│   (qgjob)       │───▶│   (Express)     │───▶│   (Bull)        │
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
                       │   Device Pool   │
                       │  (Emulators,    │
                       │   Devices,      │
                       │   BrowserStack) │
                       └─────────────────┘
```

## Quick Start

### Prerequisites
- Node.js 14.0.0 or higher
- Redis server running
- npm or yarn

### Installation

1. **Clone and navigate to backend directory:**
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

### Development Mode
```bash
npm run dev
```

## API Endpoints

### Job Management

#### Submit Job
```http
POST /api/jobs
Content-Type: application/json

{
  "org_id": "qualgent",
  "app_version_id": "xyz123",
  "test_path": "tests/onboarding.spec.js",
  "priority": "medium",
  "target": "emulator"
}
```

#### Get Job Status
```http
GET /api/jobs/{jobId}
```

#### List Jobs
```http
GET /api/jobs?org_id={orgId}&status={status}
```

#### Cancel Job
```http
DELETE /api/jobs/{jobId}
```

#### Retry Job
```http
POST /api/jobs/{jobId}/retry
```

### Monitoring

#### Health Check
```http
GET /health
```

#### Detailed Health
```http
GET /health/detailed
```

#### Queue Statistics
```http
GET /api/jobs/stats
```

#### Device Status
```http
GET /api/jobs/devices
```

#### Job Groups
```http
GET /api/jobs/groups
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowed origins |
| `LOG_LEVEL` | `info` | Logging level |

### Job Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_RETRIES` | `3` | Maximum retry attempts |
| `DEFAULT_PRIORITY` | `medium` | Default job priority |
| `DEFAULT_TARGET` | `emulator` | Default device target |

## Job Lifecycle

1. **Queued**: Job submitted and waiting in queue
2. **Scheduled**: Job assigned to device and ready to run
3. **Running**: Test execution in progress
4. **Completed**: Test finished successfully
5. **Failed**: Test failed (can be retried)
6. **Cancelled**: Job cancelled by user

## Job Grouping Logic

Jobs are automatically grouped by:
- `org_id`
- `app_version_id` 
- `target` (emulator/device/browserstack)

This ensures that tests for the same app version run on the same device, minimizing app installation overhead.

## Device Management

The system manages a pool of devices:

- **Emulators**: Local Android/iOS emulators
- **Devices**: Physical devices connected to the system
- **BrowserStack**: Cloud-based device testing

### Mock Devices (Development)
For development, the system uses mock devices:
- 2 emulators
- 2 physical devices  
- 2 BrowserStack instances

## Error Handling

### Retry Logic
- Failed jobs are automatically retried up to 3 times
- Exponential backoff between retries
- Jobs can be manually retried via API

### Fault Tolerance
- Redis connection failures are handled gracefully
- Device failures trigger job reassignment
- Service crashes don't lose queued jobs

## Monitoring & Logging

### Log Levels
- `error`: Critical errors
- `warn`: Warning messages
- `info`: General information
- `debug`: Detailed debugging info

### Health Checks
- Basic health: `/health`
- Detailed health: `/health/detailed`
- Readiness probe: `/health/ready`
- Liveness probe: `/health/live`

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Production Deployment

### Docker
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Environment Variables for Production
```bash
NODE_ENV=production
REDIS_URL=redis://your-redis-server:6379
ALLOWED_ORIGINS=https://your-domain.com
LOG_LEVEL=warn
```

## Scaling

### Horizontal Scaling
- Multiple backend instances can share the same Redis queue
- Load balancer can distribute API requests
- Each instance processes jobs independently

### Performance Tuning
- Adjust Redis connection pool size
- Configure job queue concurrency
- Optimize device pool size

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Ensure Redis server is running
   - Check `REDIS_URL` configuration
   - Verify network connectivity

2. **Jobs Not Processing**
   - Check scheduler service status
   - Verify device availability
   - Review job queue statistics

3. **High Memory Usage**
   - Monitor job queue size
   - Check for memory leaks in job processing
   - Adjust Redis memory limits

### Debug Mode
```bash
NODE_ENV=development LOG_LEVEL=debug npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License 

## Device and Agent Management

The system manages a pool of devices, each associated with an agent (worker):

- Agents are logical workers that manage one or more devices.
- Each device is assigned to a specific agent.
- Jobs are assigned to available agents based on device availability and target requirements.

### Example Agent/Device Mapping

| Agent ID | Devices Managed                |
|----------|-------------------------------|
| agent-1  | emulator-1, device-1          |
| agent-2  | emulator-2, device-2, browserstack-1, browserstack-2 |

## Testing Agent Logic

You can test the agent assignment logic using the existing API endpoints:

1. **Start the backend service:**
   ```bash
   npm start
   ```
2. **Submit jobs:**
   Use the CLI or POST `/api/jobs` with different targets (e.g., emulator, device, browserstack).
   Example payload:
   ```json
   {
     "org_id": "qualgent",
     "app_version_id": "xyz123",
     "test_path": "tests/onboarding.spec.js",
     "priority": "medium",
     "target": "emulator"
   }
   ```
3. **Check job status:**
   Use GET `/api/jobs/{jobId}`. The response will include `agent_id` and `device_id` fields showing which agent and device are handling the job.
4. **List jobs:**
   Use GET `/api/jobs?org_id=qualgent` to see all jobs and their assigned agents/devices.
5. **Check device status:**
   Use GET `/api/jobs/devices` to see the status of all devices and their current jobs.

**Note:**
- Jobs will only be assigned if an agent with an available device matching the target exists.
- The assignment is visible in the job's `agent_id` and `device_id` fields in the API response. 