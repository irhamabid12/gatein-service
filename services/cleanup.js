'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const PICTURES_DIR = path.join(__dirname, '..', 'pictures');

const PICTURE_RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 hari

const PICTURE_EXT = ['.jpg', '.jpeg', '.png'];

/**
 * Hapus gambar di folder pictures/ yang lebih dari 7 hari
 * (berdasarkan waktu modifikasi file / mtime).
 *
 * Catatan: log tidak dibersihkan di sini, karena sudah ditangani
 * oleh winston-daily-rotate-file (maxFiles: '30d') di logger.js.
 *
 * @returns {number} jumlah file yang dihapus
 */
function cleanOldPictures() {
    if (!fs.existsSync(PICTURES_DIR)) return 0;

    const limit = Date.now() - PICTURE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let deleted = 0;

    for (const fileName of fs.readdirSync(PICTURES_DIR)) {
        if (!PICTURE_EXT.includes(path.extname(fileName).toLowerCase())) continue;

        const fullPath = path.join(PICTURES_DIR, fileName);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isFile() && stat.mtimeMs < limit) {
                fs.unlinkSync(fullPath);
                deleted++;
            }
        } catch (err) {
            logger.log('error', `[CLEANUP] Gagal menghapus ${fullPath}: ${err.message}`);
        }
    }

    return deleted;
}

/**
 * Jalankan cleanup gambar sekali.
 */
function runCleanup() {
    try {
        const pics = cleanOldPictures();
        logger.log('info', `[CLEANUP] Selesai. Gambar dihapus: ${pics}`);
    } catch (err) {
        logger.log('error', `[CLEANUP] Error: ${err.message}`);
    }
}

/**
 * Jalankan cleanup saat startup, lalu ulangi setiap 24 jam.
 */
function startCleanupSchedule() {
    runCleanup();
    const timer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
    timer.unref(); // jangan menahan proses agar tidak bisa exit
}

module.exports = {
    cleanOldPictures,
    runCleanup,
    startCleanupSchedule
};
