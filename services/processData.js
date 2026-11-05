const net = require('net');
const { printTicket } = require('./printer');
const logger = require('./logger');
const config = require('../config.json');

const { triggerDetection } = require('./yoloWorker');

const { cameraHandler } = require('./camera');

/**
 * Mengirim trigger ke Python worker (melalui child_process)
 * @param {string} trigger - Pesan yang dikirim sebagai trigger (mis. ':A' atau ':R')
 * @param {string} imagePath - Path file gambar dari kamera
 * @returns {Promise<string>} - Respon string dari worker
 */
async function triggerPythonDetection(trigger, imagePath) {
    try {
        const response = await triggerDetection(trigger, imagePath);
        // Ubah jadi string agar sama dengan versi TCP sebelumnya yang return string
        return JSON.stringify(response);
    } catch (err) {
        console.error(`[YOLO] Gagal trigger worker: ${err.message}`);
        throw err;
    }
}

async function processData(data) {
    if (data.includes(':A') || data.includes(':R')) {
        const trigger = data.includes(':A') ? ':A' : ':R';

        // Ambil gambar dari kamera
        // logger.log('info', `[PROCESS] Memulai pengambilan gambar untuk trigger ${trigger}...`);
        const imagePath = await cameraHandler();

        if (imagePath) {
            // Jika berhasil ambil gambar, jalankan deteksi
            // logger.log('info', `[PROCESS] Gambar berhasil diambil: ${imagePath}. Memulai deteksi YOLO...`);
            // const yoloResultStr = await triggerPythonDetection(trigger, imagePath);
            // const yoloResult = JSON.parse(yoloResultStr);
            // logger.log('info', `[PROCESS] Hasil deteksi: ${JSON.stringify(yoloResult)}`);
            // Anda bisa tambahkan logika lanjutan di sini (seperti API call ke backend, dsb)
        } else {
            logger.log('error', '[PROCESS] Gagal mengambil gambar dari kamera.');
        }

        return;
    }
}

async function generateNoTicket(rfid = '') {
    return new Promise(async (resolve) => {

        const url = `${config.endpoint}/api/parkirMasuk`;
        let payload;

        if (rfid) {
            payload = {
                gate_masuk_id: config.parking_class.gate_id,
                kartu_pelanggan: rfid
            };
        } else {
            payload = {
                gate_masuk_id: config.parking_class.gate_id,
                golongan_id: config.parking_class.golongan_id,
                tarif_id: config.parking_class.tarif_id
            };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
            resolve(null);
        }, 30000);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (response) {
                const result = await response.json();

                if (response.status === 200) {
                    resolve(result);
                    // logger.log("info", (result.message || "Berhasil") + " [PAYLOAD]: " + JSON.stringify(payload));
                    return;
                } else {
                    if (result.status === "ERROR") {
                        logger.log("error", result.message + " [PAYLOAD]: " + JSON.stringify(payload));
                        resolve(result.message);
                        return;
                    } else {
                        logger.log("error", result + " [PAYLOAD]: " + JSON.stringify(payload));
                        resolve(null);
                        return;
                    }

                }
            } else {
                logger.log("error", "No response from server" + " [PAYLOAD]: " + JSON.stringify(payload));
                resolve(null);
                return;
            }

        } catch (err) {
            logger.log("error", err.message);
            resolve(null);
            return;

        } finally {
            clearTimeout(timeout);
        }
    });
}

module.exports = {
    processData,
    generateNoTicket
};