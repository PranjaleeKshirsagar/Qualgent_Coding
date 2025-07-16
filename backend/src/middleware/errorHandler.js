const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  // Log the error
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Default error response
  const errorResponse = {
    error: 'Internal Server Error',
    message: isDevelopment ? err.message : 'Something went wrong',
    ...(isDevelopment && { stack: err.stack })
  };

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message,
      details: err.details
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  if (err.name === 'ForbiddenError') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied'
    });
  }

  if (err.name === 'NotFoundError') {
    return res.status(404).json({
      error: 'Not Found',
      message: err.message
    });
  }

  // Handle Redis connection errors
  if (err.code === 'ECONNREFUSED' && err.message.includes('Redis')) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Queue service temporarily unavailable'
    });
  }

  // Handle timeout errors
  if (err.code === 'ETIMEDOUT') {
    return res.status(504).json({
      error: 'Gateway Timeout',
      message: 'Request timed out'
    });
  }

  // Default to 500 Internal Server Error
  res.status(500).json(errorResponse);
}

module.exports = errorHandler; 