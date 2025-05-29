// Import the winston logging library
const { createLogger, format, transports } = require('winston');

// Create a logger instance with specific settings
const logger = createLogger({
  level: 'info', // Log level: info and above (info, warn, error)
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Add timestamp
    format.printf(({ timestamp, level, message }) => {
      // Custom log message format
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new transports.Console() // Output logs to the console
  ]
});

// Export the logger so it can be used in other files
module.exports = logger;