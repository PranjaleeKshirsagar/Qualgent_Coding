const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const logger = require('./utils/logger');
const jobRoutes = require('./routes/jobs');
const healthRoutes = require('./routes/health');
const errorHandler = require('./middleware/errorHandler');
const { initializeQueues } = require('./services/queueService');
const { initializeScheduler } = require('./services/schedulerService');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Request logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.use('/health', healthRoutes);

// API routes
app.use('/api/jobs', jobRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'QualGent Job Orchestrator API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      jobs: '/api/jobs'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Error handling middleware
app.use(errorHandler);

// Initialize services
async function initializeServices() {
  try {
    // Initialize Redis queues
    await initializeQueues();
    logger.info('Queue service initialized');

    // Initialize job scheduler
    await initializeScheduler();
    logger.info('Scheduler service initialized');

    // Start server
    app.listen(PORT, () => {
      logger.info(`🚀 Job Orchestrator server running on port ${PORT}`);
      logger.info(`📊 Health check: http://localhost:${PORT}/health`);
      logger.info(`📋 API docs: http://localhost:${PORT}/`);
    });

  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
initializeServices();

module.exports = app; 