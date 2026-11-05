'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const CAPTURE_TIMEOUT_MS = 10000; // 10 seconds, same as C# version

/**
 * Get the pictures directory (inside the project root as "pictures/").
 * Creates it if it doesn't exist.
 */
function getPicturesDir() {
    const picDir = path.join(__dirname, '..', 'pictures');
    if (!fs.existsSync(picDir)) {
        fs.mkdirSync(picDir, { recursive: true });
    }
    return picDir;
}

/**
 * Resolve a final filename.
 * - If specificFileName is provided and is just a name (no path separator), use it directly.
 * - If specificFileName is a full path, extract just the filename.
 * - If null/empty, generate a temp filename.
 * - Ensures the file has a .jpg extension.
 * 
 * @param {string|null} specificFileName 
 * @returns {string} resolved filename (not a full path)
 */
function resolveFileName(specificFileName) {
    let fileName;

    if (specificFileName && specificFileName.trim() !== '') {
        if (specificFileName.includes(path.sep) || specificFileName.includes('/')) {
            fileName = path.basename(specificFileName);
        } else {
            fileName = specificFileName;
        }
    } else {
        const now = new Date();
        const ts = now.toISOString().replace(/[-:T]/g, '').substring(0, 15); // yyyyMMdd_HHmmss-ish
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        fileName = `TEMP_${ts}_${rand}.jpg`;
    }

    // Ensure a valid image extension
    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') {
        fileName += '.jpg';
    }

    return fileName;
}

/**
 * Capture a single frame from a RTSP CCTV camera using ffmpeg.
 * Equivalent to the C# CameraHandler() function.
 *
 * @param {string|null} specificFileName - Optional filename to save the image as.
 * @returns {Promise<string|null>} - Full path to the saved image, or null on failure.
 */
async function cameraHandler(specificFileName = null) {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

    const username = config.camera.username;
    const password = config.camera.password;
    const ip       = config.camera.ip;

    const rtspUrl  = `rtsp://${username}:${password}@${ip}:554/Streaming/Channels/101`;

    const picDir   = getPicturesDir();
    const fileName = resolveFileName(specificFileName);
    const fullPath = path.join(picDir, fileName);

    // logger.log("info", `[CAMERA] Capturing from: rtsp://***:***@${ip}:554/Streaming/Channels/101`);
    // logger.log("info", `[CAMERA] Saving to: ${fullPath}`);

    return new Promise((resolve) => {
        let settled = false;

        // ffmpeg args:
        //  -rtsp_transport tcp   → use TCP for more reliable RTSP
        //  -i <url>              → input
        //  -frames:v 1           → capture only 1 frame
        //  -q:v 2                → JPEG quality (1=best, 31=worst)
        //  -y                    → overwrite output without asking
        const args = [
            '-rtsp_transport', 'tcp',
            '-i', rtspUrl,
            '-frames:v', '1',
            '-q:v', '2',
            '-y',
            fullPath
        ];

        const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        // Collect stderr for error logging (ffmpeg outputs everything to stderr)
        let stderrOutput = '';
        ffmpeg.stderr.on('data', (chunk) => {
            stderrOutput += chunk.toString();
        });

        const cleanup = (result) => {
            if (settled) return;
            settled = true;
            ffmpeg.kill('SIGKILL');
            resolve(result);
        };

        // Timeout: kill ffmpeg after CAPTURE_TIMEOUT_MS
        const timer = setTimeout(() => {
            logger.log("error", `[CAMERA] Capture timeout (${CAPTURE_TIMEOUT_MS / 1000}s) for ${ip}`);
            cleanup(null);
        }, CAPTURE_TIMEOUT_MS);

        ffmpeg.on('close', (code) => {
            clearTimeout(timer);
            if (settled) return; // already resolved by timeout

            if (code === 0 && fs.existsSync(fullPath)) {
                // logger.log("info", `[CAMERA] Frame captured successfully: ${fullPath}`);
                resolve(fullPath);
            } else {
                logger.log("error", `[CAMERA] ffmpeg exited with code ${code}`);
                if (stderrOutput) {
                    logger.log("error", `[CAMERA] ffmpeg stderr: ${stderrOutput.slice(-500)}`);
                }
                resolve(null);
            }
            settled = true;
        });

        ffmpeg.on('error', (err) => {
            clearTimeout(timer);
            logger.log("error", `[CAMERA] Failed to start ffmpeg: ${err.message}`);
            cleanup(null);
        });
    });
}

module.exports = { cameraHandler };
