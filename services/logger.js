const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

let ioInstance = null;

function formatDate(date = new Date()) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const logFormat = winston.format.printf(({ level, message, timestamp }) => {
    return `[${timestamp}] [${level.toUpperCase()}]: ${message}`;
});

class SocketIOTransport extends winston.Transport {
    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        if (ioInstance && info.level === 'error') {
            let msg = info.message;
            if (info.stack) {
                msg = info.stack;
            } else if (typeof msg === 'object') {
                msg = JSON.stringify(msg);
            }
            const splatSymbol = Symbol.for('splat');
            if (info[splatSymbol] && Array.isArray(info[splatSymbol])) {
                const splatStr = info[splatSymbol]
                    .map(s => (s && s.stack ? s.stack : (typeof s === 'object' ? JSON.stringify(s) : s)))
                    .join(' ');
                if (splatStr) {
                    msg += ' ' + splatStr;
                }
            }

            // Log yang mengandung "[Gate <id>]" hanya dikirim ke gate tersebut,
            // sisanya (tanpa gate id) dikirim sebagai log global.
            const text = `${formatDate()} - ${msg}`;
            const m = String(msg).match(/\[Gate\s+([^\]\s]+)[^\]]*\]/);
            if (m) {
                ioInstance.emit("log-output", { gateId: String(m[1]), data: text });
            } else {
                ioInstance.emit("log-output", text);
            }
        }

        callback();
    }
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        logFormat
    ),
    transports: [
        new winston.transports.Console(),
        new SocketIOTransport(),
        new DailyRotateFile({
            dirname: path.join(__dirname, '../logs'),
            filename: 'app-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: false,
            maxSize: '20m',
            maxFiles: '30d'
        })
    ]
});

logger.init = (io) => {
    ioInstance = io;
};

module.exports = logger;