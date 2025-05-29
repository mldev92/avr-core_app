// Load environment variables
require("dotenv").config();

const axios = require("axios");
const EventEmitter = require("events");
const logger = require("./logger");

/**
 * Tts Class
 * - Handles streaming text-to-speech using a queue and events.
 */
class Tts extends EventEmitter {
    constructor() {
        super();
        // Initialize a queue for texts waiting to be processed
        this.textQueue = [];
        // Status flag for TTS sending
        this.isSendingText = false;
    }

    /**
     * Add text to the queue and begin processing.
     * @param {string} text
     */
    async sendToTts(text) {
        this.textQueue.push(text);
        this.processTextQueue();
    }

    /**
     * Process the TTS queue!
     * Handles one text at a time, streams the audio response,
     * emits events for audio data, errors, and when done.
     */
    async processTextQueue() {
        if (this.isSendingText || this.textQueue.length === 0) return;
        this.isSendingText = true;

        // Get the next text to process
        const text = this.textQueue.shift();
        const audioChunks = [];

        try {
            // Send request to TTS server and stream the audio response
            const response = await axios({
                method: "post",
                url: process.env.TTS_URL || "http://localhost:6003/text-to-speech-stream",
                data: { text },
                responseType: "stream",
            });

            // Stream: collect audio data chunks
            response.data.on("data", chunk => {
                audioChunks.push(chunk);
            });

            // Stream: done
            response.data.on("end", () => {
                const audioBuffer = Buffer.concat(audioChunks);
                this.emit("audio", audioBuffer);
                logger.info("TTS streaming complete:", audioBuffer.length, "bytes");
                this.emit("end");
                this.isSendingText = false;
                this.processTextQueue(); // Next!
            });

            // Stream: error
            response.data.on("error", err => {
                logger.error("Error during TTS streaming: " + err);
                this.emit("error", err);
                this.isSendingText = false;
                this.processTextQueue(); // Try next
            });
        } catch (err) {
            logger.error("Error sending text to TTS service: " + err.message);
            this.emit("error", err);
            this.isSendingText = false;
            this.processTextQueue();
        }
    }

    /**
     * Clears the text queue and reset sending state.
     */
    clearTextQueue() {
        this.textQueue = [];
        this.isSendingText = false;
    }
}

module.exports = { Tts };