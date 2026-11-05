const { spawn } = require('child_process');
const path = require('path');
const logger = require('./logger');

let pythonProcess = null;
let isReady = false;
let pendingRequests = new Map();
let requestIdCounter = 0;

/**
 * Memulai child process Python worker untuk deteksi kendaraan
 */
function startPythonWorker() {
    const scriptPath = path.join(__dirname, '..', 'python', 'detect_worker.py');
    
    logger.log('info', '[YOLO Worker] Memulai worker python...');
    
    // Spawn python process
    pythonProcess = spawn('/home/itki/venv/bin/python', [scriptPath]);
    
    pythonProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
            try {
                const response = JSON.parse(line);
                
                if (response.status === 'ready') {
                    isReady = true;
                    logger.log('info', '[YOLO Worker] Worker siap menerima trigger.');
                    continue;
                }
                
                // Menangani response dari trigger
                // Cari request yang bersangkutan (karena Python memproses berurutan, kita bisa handle berdasarkan antrean)
                // Di sini kita gunakan ID pada map jika dikirim, atau ambil yang paling lama (FIFO)
                if (pendingRequests.size > 0) {
                    // Ambil request pertama
                    const [reqId, resolve] = pendingRequests.entries().next().value;
                    pendingRequests.delete(reqId);
                    resolve(response);
                }
                
            } catch (err) {
                // Bukan JSON (bisa jadi output print biasa)
                console.log(`[YOLO Worker stdout]: ${line}`);
            }
        }
    });
    
    pythonProcess.stderr.on('data', (data) => {
        // stderr digunakan untuk log INFO/ERROR dari python
        const msg = data.toString().trim();
        console.log(`${msg}`);
    });
    
    pythonProcess.on('close', (code) => {
        logger.log('error', `[YOLO Worker] Python process berhenti dengan code ${code}. Merestart dalam 5 detik...`);
        isReady = false;
        
        // Fail semua pending request
        for (const [reqId, resolve] of pendingRequests.entries()) {
            resolve({ status: 'error', message: 'Worker crashed' });
        }
        pendingRequests.clear();
        
        // Restart worker
        setTimeout(startPythonWorker, 5000);
    });
}

/**
 * Mengirim trigger ke Python worker via stdin
 * @param {string} trigger - Pesan yang dikirim sebagai trigger (mis. ':A' atau ':R')
 * @param {string} imagePath - Path dari file gambar untuk dideteksi
 * @returns {Promise<Object>} - Respon JSON dari python worker
 */
function triggerDetection(trigger, imagePath) {
    return new Promise((resolve, reject) => {
        if (!pythonProcess || !isReady) {
            return resolve({ status: 'error', message: 'Worker belum siap' });
        }
        
        const reqId = requestIdCounter++;
        pendingRequests.set(reqId, resolve);
        
        // Kirim trigger dan image path ke stdin dalam format JSON
        const payload = JSON.stringify({ trigger: trigger, image_path: imagePath });
        pythonProcess.stdin.write(`${payload}\n`);
    });
}

// Mulai worker saat file ini di-require
startPythonWorker();

module.exports = {
    triggerDetection
};
