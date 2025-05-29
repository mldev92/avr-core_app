// Load environment variables from .env file
require('dotenv').config();

const axios = require('axios');
const { PassThrough } = require('stream');
const EventEmitter = require('events');
const logger = require('./logger');

class Sts extends EventEmitter {
    constructor() {
        super();
        this.stream = null;
        this.responseStream = null;
    }

    async startStreaming() {
        this.stream = new PassThrough();

        try {
            const response = await axios({
                method: 'post',
                url: process.env.STS_URL || 'http://localhost:6030/speech-to-speech-stream',
                headers: {
                    'Content-Type': 'audio/l16',
                    'Transfer-Encoding': 'chunked'
                },
                data: this.stream,
                responseType: 'stream'
            });

            this.responseStream = response.data;

            // Listen for audio data from the response stream
            this.responseStream.on('data', (chunk) => {
                this.emit('audio', chunk);
            });

            // Listen for the end of the response stream
            this.responseStream.on('end', () => {
                logger.info('Streaming complete');
                this.emit('end');
            });

            // Listen for errors on the response stream
            this.responseStream.on('error', (err) => {
                logger.error('Error during external service streaming: ' + err);
                this.emit('error', err);
            });

        } catch (err) {
            logger.error('Error starting streaming to external asr service: ' + err.message);
            this.emit('error', err);
        }
    }

    async processAudio(audioChunk) {
        if (!this.stream) {
            await this.startStreaming();
        } else {
            this.stream.write(audioChunk);
        }
    }

    stopStreaming() {
        if (this.stream) {
            this.stream.end();
            this.stream = null;
            logger.info('Streaming stopped');
        }
    }
}

module.exports = { Sts };