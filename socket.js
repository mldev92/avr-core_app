// Load environment variables
require('dotenv').config();

const { EventEmitter } = require('events');
const { toUUID } = require('to-uuid');
const { Asr } = require('./asr');
const { Llm } = require('./llm');
const { Tts } = require('./tts');
const { Sts } = require('./sts');
const logger = require('./logger');

// Packet type constants
const TERMINATE_PACKET = 0x0;
const UUID_PACKET = 0x1;
const AUDIO_PACKET = 0x10;
const ERROR_PACKET = 0xff;
const TERMINATE_PACKET_LENGTH = 3;
const MAX_CHUNK_SIZE = 320;

class ClientHandler extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
        this.uuid = null;
        this.messages = [];
        this.audioQueue = [];
        this.isSendingAudio = false;

        this.asr = new Asr();
        this.llm = new Llm();
        this.tts = new Tts();
        this.sts = new Sts();

        this.setupSocket();
        this.setupEvents();
    }

    setupSocket() {
        this.socket.on('data', this.handleData.bind(this));
        this.socket.on('end', this.handleEnd.bind(this));
        this.socket.on('error', this.handleError.bind(this));
    }

    setupEvents() {
        // ASR events
        this.asr.on('transcript', this.handleTranscript.bind(this));
        this.asr.on('end', this.handleAsrEnd.bind(this));
        this.asr.on('error', this.handleAsrError.bind(this));

        // LLM events
        this.llm.on('text', this.handleLlmText.bind(this));
        this.llm.on('audio', this.handleLlmAudio.bind(this));
        this.llm.on('end', this.handleLlmEnd.bind(this));
        this.llm.on('error', this.handleLlmError.bind(this));

        // TTS events
        this.tts.on('audio', this.handleTtsAudio.bind(this));
        this.tts.on('end', this.handleTtsEnd.bind(this));
        this.tts.on('error', this.handleTtsError.bind(this));

        // STS events
        this.sts.on('audio', this.handleStsAudio.bind(this));
        this.sts.on('end', this.handleStsEnd.bind(this));
        this.sts.on('error', this.handleStsError.bind(this));
    }

    async handleData(buffer) {
        const packetType = buffer.readUInt8(0);
        const packetLength = buffer.readUInt16BE(1);

        switch (packetType) {
            case TERMINATE_PACKET:
                this.handleTerminatePacket();
                break;
            case UUID_PACKET:
                this.handleUuidPacket(buffer, packetLength);
                break;
            case AUDIO_PACKET:
                this.handleAudioPacket(buffer, packetLength);
                break;
            case ERROR_PACKET:
                this.handleErrorPacket(buffer, packetLength);
                break;
            default:
                logger.error('Unknown packet type: ' + packetType);
                break;
        }
    }

    handleErrorPacket(buffer, length) {
        logger.error('Error packet received: ' + buffer + ', ' + length);
    }

    async handleUuidPacket(buffer, length) {
        this.uuid = toUUID(buffer.slice(3, 3 + length).toString('hex'));
        logger.info('UUID packet received: ' + this.uuid);
        this.startAudioProcessing();

        if (process.env.SYSTEM_MESSAGE) {
            logger.info('SYSTEM_MESSAGE: ' + process.env.SYSTEM_MESSAGE);
            this.sendLlmText(process.env.SYSTEM_MESSAGE);
        } else {
            const systemMessage = {
                role: 'system',
                content: 'You are ' + (process.env.SYSTEM_NAME || 'an AI assistant') + '. You must introduce yourself quickly and concisely.'
            };
            this.messages.push(systemMessage);
        }
    }

    handleAudioPacket(buffer, length) {
        const audioData = buffer.slice(3, 3 + length);

        if (process.env.STS_URL) {
            this.sts.processAudio(audioData);
        } else if (process.env.INTERRUPT_LISTENING === 'true') {
            if (this.isSendingAudio) {
                this.asr.stopStreaming();
            } else {
                this.asr.processAudio(audioData);
            }
        } else {
            this.asr.processAudio(audioData);
        }
    }

    handleTerminatePacket() {
        logger.info('Terminate packet received');
        this.audioQueue = [];
        this.asr.stopStreaming();
        this.tts.stopStreaming();
        this.sts.stopStreaming();
    }

    async startAudioProcessing() {
        setImmediate(async () => {
            while (!this.socket.destroyed) {
                if (this.audioQueue.length > 0) {
                    const audio = this.audioQueue.shift();
                    this.isSendingAudio = true;
                    await this.sendAudioPacket(audio);
                } else {
                    this.isSendingAudio = false;
                    await this.sendAudioPacket(Buffer.alloc(MAX_CHUNK_SIZE, 0xff));
                }
                await new Promise(res => setTimeout(res, 10));
            }
        });
    }

    async sendAudioPacket(audioBuffer) {
        for (let i = 0; i < audioBuffer.length; i += MAX_CHUNK_SIZE) {
            let chunk = audioBuffer.slice(i, Math.min(i + MAX_CHUNK_SIZE, audioBuffer.length));
            const padding = Buffer.alloc(MAX_CHUNK_SIZE - chunk.length, 0xff);
            chunk = Buffer.concat([chunk, padding]);

            const header = Buffer.alloc(3);
            header.writeUInt8(AUDIO_PACKET, 0);
            header.writeUInt16BE(chunk.length, 1);

            const packet = Buffer.concat([header, chunk]);
            if (this.socket.writable) {
                this.socket.write(packet);
                await new Promise(res => setTimeout(res, 20));
            }
        }
    }

    handleTranscript(transcript) {
        this.audioQueue = [];
        this.tts.clearTextQueue();
        const userMessage = { role: 'user', content: transcript };
        this.messages.push(userMessage);
        logger.info('Sends transcript from ASR to LLM: ' + transcript);
        this.llm.sendToLlm(this.uuid, transcript, this.messages);
    }

    handleAsrEnd() {
        logger.info('ASR streaming ended');
    }

    handleAsrError(error) {
        logger.error('Error during streaming to ASR: ' + error.message);
        this.handleTerminatePacket();
        this.emit('error', error);
    }

    sendLlmText(text) {
        const assistantMessage = { role: 'assistant', content: text };
        this.messages.push(assistantMessage);
        logger.info('Sends text from Llm to Tts: ' + text);
        this.tts.sendToTts(text);
    }

    handleLlmAudio(audio) {
        this.audioQueue.push(audio);
    }

    handleLlmEnd() {
        logger.info('LLM streaming ended');
    }

    handleLlmError(error) {
        logger.error('Error during streaming to LLM: ' + error.message);
        this.handleTerminatePacket();
        this.emit('error', error);
    }

    handleTtsAudio(audio) {
        this.audioQueue.push(audio);
    }

    handleTtsEnd() {
        logger.info('TTS streaming ended');
    }

    handleTtsError(error) {
        logger.error('Error during streaming to TTS: ' + error.message);
        this.handleTerminatePacket();
        this.emit('error', error);
    }

    handleStsAudio(audio) {
        this.audioQueue.push(audio);
    }

    handleStsEnd() {
        logger.info('STS streaming ended');
    }

    handleStsError(error) {
        logger.error('Error during streaming to STS: ' + error.message);
        this.handleTerminatePacket();
        this.emit('error', error);
    }

    handleEnd() {
        logger.info('Socket Client disconnected');
        this.handleTerminatePacket();
        this.emit('end');
    }

    handleError(error) {
        if (error instanceof AggregateError) {
            error.errors.forEach(e => logger.error('Socket error: ' + e.message));
        } else {
            logger.error('Socket error: ' + error.message);
        }
        this.handleTerminatePacket();
        this.emit('error', error);
    }

    sendHangupPacket() {
        const empty = Buffer.alloc(0);
        const packet = Buffer.alloc(TERMINATE_PACKET_LENGTH + empty.length);
        packet.writeUInt8(TERMINATE_PACKET, 0);
        packet.writeUInt16BE(empty.length, 1);
        empty.copy(packet, TERMINATE_PACKET_LENGTH);
        this.socket.write(packet);
    }
}

module.exports = { ClientHandler };