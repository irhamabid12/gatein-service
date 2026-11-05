const net = require('net');
const config = require('../config.json');
const logger = require('./logger');

async function sendBytesToPrinter(ip, port, buffer, timeout = 5000) {
    return new Promise(resolve => {
    
        const client = new net.Socket();

        let finished = false;

        const done = (result) => {
            if (!finished) {
                finished = true;
                client.destroy();
                resolve(result);
            }
        };

        client.setTimeout(timeout);

        client.connect(port, ip, () => {
            try {
                client.write(buffer, (err) => {
                    if (err) return done(false);
                    
                    client.end();   
                    done(true);
                });
            } catch (error) {
                done(false);
            }
        });

        client.on('timeout', () => {
            logger.log("info", "Printer timeout");
            done(false);
        });

        client.on('error', (error) => {
            logger.log("error", error);
            done(false);
        });
    });
}

async function printTicket(ticketNo, isRfid = false) {

    const line = '-'.repeat(48);

    const chunks = [];

    // ESC/POS Commands
    const INIT          = Buffer.from([0x1B, 0x40]);
    const ALIGN_LEFT    = Buffer.from([0x1B, 0x61, 0x00]);
    const ALIGN_CENTER  = Buffer.from([0x1B, 0x61, 0x01]);
    const BOLD_ON       = Buffer.from([0x1B, 0x45, 0x01]);
    const BOLD_OFF      = Buffer.from([0x1B, 0x45, 0x00]);
    const CUT           = Buffer.from([0x1D, 0x56, 0x41, 0x10]);

    chunks.push(INIT);
    chunks.push(ALIGN_CENTER);

    chunks.push(Buffer.from("RSUD Dr. Soetomo\n"));
    chunks.push(Buffer.from("Jl. Prof. DR. Moestopo No.6-8, Airlangga,\n"));
    chunks.push(Buffer.from("Gubeng, Surabaya, Jawa Timur 60286\n"));

    if (isRfid) {
        chunks.push(BOLD_ON);
        chunks.push(Buffer.from(`${line}\n`));
        chunks.push(Buffer.from("MEMBER\n"));
        chunks.push(Buffer.from(`${line}\n`));
        chunks.push(BOLD_OFF);
    } else {
        chunks.push(Buffer.from(`${line}\n`));
    }

    // Barcode
    chunks.push(generateBarcode(ticketNo));

    chunks.push(Buffer.from("\n"));

    chunks.push(ALIGN_LEFT);

    const now = new Date();

    chunks.push(Buffer.from(`WAKTU MASUK   : ${formatDate(now)} ${formatTime(now)}\n`));
    chunks.push(Buffer.from(`GATE          : ${config.parking_class.nama_gate}\n`));
    chunks.push(Buffer.from(`GOLONGAN      : ${config.parking_class.nama_golongan}\n`));

    chunks.push(ALIGN_CENTER);
    chunks.push(Buffer.from(`${line}\n`));
    chunks.push(Buffer.from("JANGAN TINGGALKAN KARCIS TANDA MASUK\n"));
    chunks.push(Buffer.from("TERIMA KASIH\n\n"));

    chunks.push(CUT);

    const buffer = Buffer.concat(chunks);

    const isSuccess = await sendBytesToPrinter(config.printer.ip, config.printer.port, buffer, 5000);

    return isSuccess;
}

function generateBarcode(code) {

    return Buffer.concat([
        Buffer.from([0x1D, 0x48, 0x02]), // HRI below
        Buffer.from([0x1D, 0x68, 80]),   // height
        Buffer.from([0x1D, 0x77, 2]),    // width
        Buffer.from([0x1D, 0x6B, 73, code.length]),
        Buffer.from(code)
    ]);
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${day}/${month}/${year}`;
}

function formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

module.exports = { printTicket };