const net = require('net');
const { handleReconnect } = require('./reconnect');
const { printTicket } = require('./printer');
const { generateNoTicket } = require('./processData');
const { processData } = require('./processData');
const logger = require('./logger');
const config = require('../config.json');
const { cameraHandler } = require('./camera');
const { uploadImage } = require('./upload');

let client = null;
let io = null;
let isConnecting = false;
let isDisconnecting = false;
let isProccess = false;

const ip = config.controller.ip;
const port = config.controller.port;

function formatDate(date = new Date()) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function init(socketIO) {
    io = socketIO;
    logger.init(socketIO);
} 

function startConnection() {
    isDisconnecting = false;
    
    if (client && !client.destroyed) {
        console.log("Already connected");
        return;
    }

    if (isConnecting) {
        console.log("Connecting... Please wait.");
        return;
    }

    isConnecting = true;

    logger.log("info", `[TCP] Memulai koneksi ke controller ${ip}:${port}...`);

    client = new net.Socket();

    client.connect(port, ip, () => {
        console.clear();
        console.log("====================================");
        console.log("CONNECTED TO CONTROLLER");
        console.log(`IP: ${ip} PORT: ${port}`);
        console.log("====================================");
        isConnecting = false;

        logger.log("info", `[TCP] Terhubung ke controller ${ip}:${port}`);

        io.emit("controller-status", "online");
        io.emit("status-device", "connected");
    });

    client.setKeepAlive(true, 5000);

    client.on('data', async (data) => {

        if (isDisconnecting) {
            return;
        }

        let message = data.toString('ascii');
        message = message.trim();
        
        if(isProccess) {
            return;
        }

        if (message == ":A") {
            if (io) {
                io.emit("log-output", `${formatDate()} - Trigger masuk dengan tiket`);
            }
            // processData(message);
            
            isProccess = true;

            try {
                const ticket = await generateNoTicket();
                if (ticket != null) {
                    const res = await printTicket(ticket.kode_parkir, false);

                    if (res) {
                        sendData("S02\r\n");
                    } else {
                        logger.log("error", "Print ticket failed");
                        sendData("ER!\r\n");
                        return;
                    }

                    const fileName = ticket?.foto_masuk;
                    const filePath = await cameraHandler(fileName);

                    if (filePath) {
                        await uploadImage(filePath);
                    }
                } else {
                    logger.log("error", "Ticket not found");
                    sendData("ER!\r\n");
                }
                
            }catch(err) {
                logger.log("error", "Error: ", err);
                sendData("ER!\r\n");
            }finally {
                isProccess = false;
            }

        } else if (message.startsWith(":R")) {
            

            // processData(message);

            if (config.parking_class.member == false) {
                sendData("ER!\r\n");
                return;
            }

            isProccess = true;
            const rfid = message.replace(/^:R/, '');
            console.log('pelanggan ' + rfid);

            if (io) {
                io.emit("log-output", `${formatDate()} - Trigger masuk dengan kartu member, RFID: ${rfid}`);
            }

            try {
                const ticket = await generateNoTicket(rfid);
                if (ticket != null) {
                    if (ticket == "Anda sudah pernah masuk") {
                        if (io) {
                            io.emit("log-output", `${formatDate()} - Pelanggan sudah pernah masuk`);
                        }
                        sendData("S03\r\n");
                        return;
                    }

                    if (ticket == "Pelanggan tidak ditemukan") {
                        if (io) {
                            io.emit("log-output", `${formatDate()} - Pelanggan tidak ditemukan`);
                        }
                        sendData("S03\r\n");
                        return;
                    }

                    let res = true;
                    if (config.parking_class.print_ticket_member) {
                        res = await printTicket(ticket.kode_parkir, config.parking_class.member ? true : false);
                    }
                    
                    if (res) {
                        sendData("S02\r\n");
                    } else {
                        logger.log("error", "Print ticket failed");
                        sendData("ER!\r\n");
                        return;
                    }

                    const fileName = ticket?.foto_masuk;
                    const filePath = await cameraHandler(fileName);

                    if (filePath) {
                        await uploadImage(filePath);
                    }
                } else {
                    logger.log("error", "Ticket not found");
                    sendData("ER!\r\n");
                }
                
            }catch(err) {
                logger.error("Error: ", err);
                sendData("ER!\r\n");
            }finally {
                isProccess = false;
            }
        } else if (message.startsWith(":C")) {
            if (io) {
                io.emit("log-output", `${formatDate()} - Kendaraan terdeteksi`);
                setTimeout(() => {
                    io.emit("log-output", "end process");
                }, 2000);
            }
            logger.log("info", "Kendaraan terdeteksi");
        } else {
            logger.log("warn", "Unknown message: ", message);
        }
    });

    client.on('error', (err) => {
        logger.log("error", `[TCP] Error koneksi controller ${ip}:${port}: ${err.message}`);

        io.emit("controller-status", "offline"); 
    });

    client.on('close', (hadError) => {
        if (isDisconnecting) {
            logger.log("info", "[TCP] Koneksi ditutup (disconnect manual).");
        } else {
            logger.log("warn", `[TCP] Koneksi ke controller terputus (lost connect)${hadError ? ' karena error' : ''}. Mencoba reconnect...`);
        }
        isConnecting = false;
        if (client) {
            client.removeAllListeners();
            client.destroy();
            client = null;
        }
        if (!isDisconnecting) {
            handleReconnect(startConnection, ip, port);
        }

        io.emit("controller-status", "offline"); 
    });
}

function disconnect() {
    isDisconnecting = true;

    if (client) {
        client.destroy();
        client = null;
        console.log("Disconnected");
    }

    io.emit("status-device", "disconnected");
}

function getStatus() {
    const res = {
        ip: ip,
        port: port,
        connected: client && !client.destroyed,
        connecting: isConnecting,
        disconnecting: isDisconnecting
    }

    return res;
}

/**
 * Kirim perintah ke controller (S02, S03, ER!, OFF, dll) dengan retry otomatis.
 * Non-blocking: pemanggil yang butuh hasil bisa memakai `await` pada return-nya
 * atau langsung memakai sendDataWithRetry.
 *
 * @param {string} message
 * @returns {Promise<boolean>} true jika berhasil terkirim
 */
function sendData(message) {
    return sendDataWithRetry(message);
}

/**
 * Kirim perintah ke controller (mis. buka gate) dengan percobaan ulang.
 * Bila koneksi terputus atau terjadi error saat menulis, akan mencoba reconnect
 * lalu mengirim ulang sampai `maxRetries` kali.
 *
 * @param {string} message - Perintah yang dikirim
 * @param {number} maxRetries - Jumlah percobaan maksimal
 * @param {number} delayMs - Jeda antar percobaan (ms)
 * @returns {Promise<boolean>} true jika berhasil terkirim
 */
async function sendDataWithRetry(message, maxRetries = 3, delayMs = 1500) {
    const label = JSON.stringify(message);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (!client || client.destroyed) {
                throw new Error('Controller tidak terhubung');
            }

            await new Promise((resolve, reject) => {
                client.write(message, 'ascii', (err) => (err ? reject(err) : resolve()));
            });

            if (attempt > 1) {
                logger.log("info", `[TCP] Perintah ${label} berhasil terkirim pada percobaan ke-${attempt}`);
            }
            return true;
        } catch (err) {
            logger.log("warn", `[TCP] Gagal kirim perintah ${label} (percobaan ${attempt}/${maxRetries}): ${err.message}`);

            if (attempt < maxRetries) {
                if (!client || client.destroyed) {
                    startConnection();
                }
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    }

    logger.log("error", `[TCP] Perintah ${label} gagal terkirim setelah ${maxRetries} percobaan`);
    return false;
}

module.exports = {
    init,
    startConnection,
    disconnect,
    getStatus,
    sendData,
    sendDataWithRetry
};