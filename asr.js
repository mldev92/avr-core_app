// Load environment variables from .env file
require('dotenv').config();

const axios = require('axios');
const { PassThrough } = require('stream');
const EventEmitter = require('events');
const logger = require('./logger');

class Asr extends EventEmitter {
  constructor() {
    super();
    this.stream = null;           // For sending audio data
    this.responseStream = null;   // For receiving ASR results
  }

  // Start streaming audio to the ASR service
  async startStreaming() {
    this.stream = new PassThrough();

    try {
      const response = await axios({
        method: 'post',
        url: process.env.ASR_URL || 'http://localhost:6010/speech-to-text-stream',
        headers: {
          'Content-Type': 'audio/l16',
          'Transfer-Encoding': 'chunked'
        },
        data: this.stream,
        responseType: 'stream'
      });

      this.responseStream = response.data;

      // Listen for data (transcription results) from ASR service
      this.responseStream.on('data', (chunk) => {
        const transcript = chunk.toString();
        logger.info('Received data from external asr service: ' + transcript);
        this.emit('transcript', transcript);
      });

      // Listen for end of stream
      this.responseStream.on('end', () => {
        logger.info('Streaming complete');
        this.emit('end');
      });

      // Listen for errors
      this.responseStream.on('error', (err) => {
        logger.error('Error during external service streaming: ' + err);
        this.emit('error', err);
      });

    } catch (err) {
      logger.error('Error starting streaming to external asr service: ' + err.message);
      this.emit('error', err);
    }
  }

  // Send audio data to the ASR service
  async processAudio(audioChunk) {
    if (!this.stream) {
      await this.startStreaming();
    }
    this.stream.write(audioChunk);
  }

  // Stop streaming audio and clean up
  stopStreaming() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
      logger.info('Streaming stopped');
    }
  }
}

module.exports = { Asr };