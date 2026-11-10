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
function cleanOldPictures(dir = PICTURES_DIR, isRoot = true) {
    if (!fs.existsSync(dir)) return 0;

    const limit = Date.now() - PICTURE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let deleted = 0;

    // Rekursif: pictures/<nama-gate>/<tanggal>/file.jpg
    for (const name of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, name);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                deleted += cleanOldPictures(fullPath, false);
            } else if (PICTURE_EXT.includes(path.extname(name).toLowerCase()) && stat.mtimeMs < limit) {
                fs.unlinkSync(fullPath);
                deleted++;
            }
        } catch (err) {
            logger.log('error', `[CLEANUP] Gagal menghapus ${fullPath}: ${err.message}`);
        }
    }

    // Hapus folder kosong (kecuali folder root pictures/)
    if (!isRoot) {
        try {
            if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
        } catch (err) { /* abaikan */ }
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
