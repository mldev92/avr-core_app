// Load environment variables
require('dotenv').config();

const axios = require('axios');
const EventEmitter = require('events');
const logger = require('./logger');

class Llm extends EventEmitter {
    constructor() {
        super();
        this.accumulatedContent = '';
    }

    // Send a message to the LLM and handle the streaming response
    async sendToLlm(uuid, message, messages) {
        try {
            const response = await axios({
                method: 'post',
                url: process.env.LLM_URL || 'http://localhost:6009/prompt-stream',
                headers: { 'Content-Type': 'application/json' },
                data: { uuid, message, messages },
                responseType: 'stream'
            });

            // Listen for data chunks from the LLM
            response.data.on('data', chunk => {
                const chunkStr = chunk.toString();
                logger.info('Received data from LLM service: ' + chunkStr);

                try {
                    const parsed = JSON.parse(chunkStr);

                    if (parsed.type === 'text') {
                        this.handleText(parsed.content);
                    } else if (parsed.type === 'audio') {
                        this.handleAudio(parsed.content);
                    } else {
                        logger.error('Unknown data type: ' + parsed.type);
                    }
                } catch (err) {
                    logger.error('Error parsing LLM service response: ' + err);
                    this.emit('error', err);
                }
            });

            // When the stream ends
            response.data.on('end', () => {
                logger.info('LLM streaming complete');
                if (this.accumulatedContent) {
                    const cleaned = this.cleanText(this.accumulatedContent);
                    logger.info('Cleaned text content on end');
                    this.emitCompleteSentences(cleaned);
                    this.accumulatedContent = '';
                }
                this.emit('end');
            });

            // Handle stream errors
            response.data.on('error', err => {
                logger.error('Error during LLM streaming: ' + err);
                this.emit('error', err);
            });

        } catch (err) {
            logger.error('Error sending data to LLM service: ' + err.message);
            this.emit('error', err);
        }
    }

    // Handle text chunks from the LLM
    handleText(textChunk) {
        logger.info('Handling text content: ' + textChunk);
        this.accumulatedContent += textChunk;

        // Split into complete sentences
        const sentences = this.accumulatedContent.match(/[^.!?]*[.!?]/g);
        if (sentences) {
            sentences.forEach(sentence => {
                const cleaned = this.cleanText(sentence);
                logger.info('Emitting complete sentence: ' + cleaned);
                this.emit('text', cleaned);
            });
            // Remove emitted sentences from accumulatedContent
            this.accumulatedContent = this.accumulatedContent.replace(/[^.!?]*[.!?]/g, '');
        }
    }

    // Emit all complete sentences in a string
    emitCompleteSentences(text) {
        const sentences = text.match(/[^.!?]*[.!?]/g);
        if (sentences) {
            sentences.forEach(sentence => {
                logger.info('Emitting complete sentence: ' + sentence);
                this.emit('text', sentence);
            });
        }
    }

    // Handle audio chunks from the LLM
    handleAudio(audioChunk) {
        logger.info('Handling audio chunk: ' + audioChunk);
        this.emit('audio', audioChunk);
    }

    // Clean up text: remove unwanted characters, formatting, etc.
    cleanText(text) {
        return text
            .replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{M}\s]/gu, '') // Remove unwanted unicode
            .replace(/【.*?】/g, '') // Remove 【...】 blocks
            .replace(/\*+/g, '') // Remove asterisks
            .replace(/\n+/g, ' ') // Replace newlines with space
            .replace(/#+/g, '') // Remove hashtags
            .trim();
    }
}

module.exports = { Llm };