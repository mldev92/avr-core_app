const net = require('net');
const { ClientHandler } = require('./socket');
const logger = require('./logger');

// Helper function to calculate connection duration in seconds
function calculateDurationInSeconds(startTime) {
    // performance.now() returns milliseconds, so divide by 1000 for seconds
    return ((performance.now() - startTime) / 1000).toFixed(2);
}

// Create the TCP server
const server = net.createServer(socket => {
    logger.info('Client connected');
    const connectionStart = performance.now();
    const client = new ClientHandler(socket);

    client.on('disconnect', () => {
        logger.info('Client connection duration: ' + calculateDurationInSeconds(connectionStart) + ' seconds');
    });

    client.on('error', err => {
        logger.error('Handling socket error: ' + err);
        logger.info('Client connection duration: ' + calculateDurationInSeconds(connectionStart) + ' seconds');
    });
});

// Use environment variable PORT or default to 5001
const port = process.env.PORT || 5001;

// Start listening
server.listen(port, () => {
    logger.info('Server listening on port ' + port);
});

// Handle server-level errors
server.on('error', err => {
    logger.error('Server error: ' + err);
});