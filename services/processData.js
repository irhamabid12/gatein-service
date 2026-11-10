const logger = require('./logger');
const { getGateConfig } = require('./configManager');

// Catatan: Python AI (yoloWorker) sengaja TIDAK di-load di sini agar tidak ikut berjalan.

function resolveConfig(gateIdOrConfig) {
    if (gateIdOrConfig && typeof gateIdOrConfig === 'object' && gateIdOrConfig.parking_class) {
        return gateIdOrConfig;
    }
    return getGateConfig(gateIdOrConfig);
}

async function generateNoTicket(rfid = '', gateIdOrConfig = null) {
    const config = resolveConfig(gateIdOrConfig);
    if (!config) {
        logger.log("error", "[PROCESS] Konfigurasi gate tidak ditemukan");
        return null;
    }

    const gateId = config.parking_class.gate_id;
    const url = `${config.endpoint}/api/parkirMasuk`;
    const payload = rfid
        ? { gate_masuk_id: gateId, kartu_pelanggan: rfid }
        : { gate_masuk_id: gateId, golongan_id: config.parking_class.golongan_id, tarif_id: config.parking_class.tarif_id };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30000)
        });

        const result = await response.json();

        if (response.status === 200) return result;

        if (result.status === "ERROR") {
            logger.log("error", `[Gate ${gateId}] ${result.message} [PAYLOAD]: ${JSON.stringify(payload)}`);
            return result.message;
        }
        logger.log("error", `[Gate ${gateId}] ${JSON.stringify(result)} [PAYLOAD]: ${JSON.stringify(payload)}`);
        return null;
    } catch (err) {
        logger.log("error", `[Gate ${gateId}] ${err.message}`);
        return null;
    }
}

/**
 * Update status transaksi parkir di database (misal ketika berhasil generate kode_parkir tapi gagal cetak tiket).
 * Endpoint: POST ${config.endpoint}/api/parkirMasuk/update-status-transaksi
 * Parameter: kode_parkir (string) & status (string)
 *
 * @param {string} kodeParkir
 * @param {string} status
 * @param {string|object|null} gateIdOrConfig
 * @returns {Promise<object|null>}
 */
async function updateStatusTransaksi(kodeParkir, status = 'error', gateIdOrConfig = null) {
    const config = resolveConfig(gateIdOrConfig);
    if (!config) {
        logger.log("error", "[PROCESS] Konfigurasi gate tidak ditemukan saat update status transaksi");
        return null;
    }

    const gateId = config.parking_class.gate_id;
    const url = `${config.endpoint}/api/parkirMasuk/update-status-transaksi`;
    const payload = {
        kode_parkir: String(kodeParkir),
        status: String(status)
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30000)
        });

        const result = await response.json();

        if (response.status === 200 || result?.status === 'success') {
            logger.log("info", `[Gate ${gateId}] [UPDATE STATUS] (${result.status}) ${result.message} [PAYLOAD]: ${JSON.stringify(payload)}`);
        } else if (response.status === 404 || result?.status === 'not_found') {
            logger.log("warn", `[Gate ${gateId}] [UPDATE STATUS] (${result.status}) ${result.message} [PAYLOAD]: ${JSON.stringify(payload)}`);
        } else {
            logger.log("error", `[Gate ${gateId}] [UPDATE STATUS] (${result?.status || response.status}) ${result?.message || JSON.stringify(result)} [PAYLOAD]: ${JSON.stringify(payload)}`);
        }

        return result;
    } catch (err) {
        logger.log("error", `[Gate ${gateId}] [UPDATE STATUS] Gagal menghubungi endpoint: ${err.message} [PAYLOAD]: ${JSON.stringify(payload)}`);
        return null;
    }
}

module.exports = { generateNoTicket, updateStatusTransaksi };
