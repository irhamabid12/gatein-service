# Parking Gate Controller – Plat Number Detection

Aplikasi Node.js untuk mengontrol gate parkir: terhubung ke controller via TCP,
mengambil gambar dari kamera CCTV (RTSP/ffmpeg), mendeteksi plat nomor
(YOLO/OCR via Python), mencetak tiket, dan berkomunikasi dengan server parkir.
Dilengkapi dashboard web dengan monitoring real-time (Socket.IO).

## Fitur

- Koneksi TCP ke controller gate (buka/tutup gate, reset).
- Capture gambar dari kamera RTSP menggunakan `ffmpeg`.
- Deteksi plat nomor via worker Python (`python/detect_worker.py`).
- Cetak tiket ke printer jaringan (port 9100).
- Generate nomor tiket ke endpoint server (`/api/parkirMasuk`).
- Dashboard & pengaturan konfigurasi via web.
- Monitoring ping controller, printer, kamera, dan endpoint setiap 2 detik.
- Pembersihan otomatis gambar (> 7 hari) dan log (> 30 hari).

## Kebutuhan

- Node.js 18+
- `ffmpeg` terpasang di PATH
- Python 3 beserta dependensi deteksi (untuk worker YOLO/OCR)

## Instalasi & Menjalankan

```bash
npm install
npm run dev      # menggunakan nodemon
# atau
node app.js
```

Dashboard: `http://<device.ip>:<device.port>` (default port `3002`).

## Struktur Folder

| Path | Keterangan |
|------|------------|
| `app.js` | Entry point: Express, Socket.IO, endpoint API |
| `config.json` | Konfigurasi device, controller, printer, kamera, endpoint |
| `services/tcpClient.js` | Koneksi TCP ke controller |
| `services/camera.js` | Capture gambar RTSP via ffmpeg ke `pictures/` |
| `services/processData.js` | Proses trigger `:A` / `:R` & generate nomor tiket |
| `services/yoloWorker.js` | Penghubung ke worker Python |
| `services/printer.js` | Cetak tiket |
| `services/upload.js` | Upload data/gambar |
| `services/monitor.js` | Monitoring status |
| `services/logger.js` | Logger winston + rotasi harian |
| `services/cleanup.js` | Hapus gambar & log lama otomatis |
| `python/` | Script deteksi plat nomor |
| `view/`, `assets/` | Dashboard web |
| `pictures/` | Hasil capture kamera |
| `logs/` | File log harian |

## Konfigurasi (`config.json`)

| Key | Keterangan |
|-----|------------|
| `device` | Nama, IP, dan port aplikasi |
| `controller` | IP & port controller gate |
| `printer` | IP & port printer |
| `camera` | IP, port, username, password kamera |
| `endpoint` | URL server aktif (`endpoint_local` / `endpoint_live`) |
| `parking_class` | Golongan, tarif, gate, status member, cetak tiket member |

Konfigurasi dapat diubah lewat dashboard atau `POST /api/config`.
Aplikasi akan restart otomatis (via nodemon) setelah konfigurasi disimpan.

> **Catatan keamanan:** `config.json` berisi kredensial kamera. Jangan commit
> ke repositori publik.

## API Endpoint

| Method | Path | Fungsi |
|--------|------|--------|
| POST | `/connect` | Mulai koneksi ke controller |
| POST | `/disconnect` | Putus koneksi controller |
| POST | `/reset` | Kirim perintah reset (`ER!`) |
| POST | `/open-gate` | Buka gate (`ON!`) |
| POST | `/close-gate` | Tutup gate (`OFF`) |
| POST | `/api/print-ticket` | Cetak tiket (`ticketNo`, `isRfid`) |
| GET | `/api/config` / `/api/get-config` | Ambil konfigurasi |
| POST | `/api/config` | Simpan konfigurasi |
| GET | `/status` | Status koneksi controller |
| GET | `/` | Dashboard |

## Event Socket.IO

- `pingData` – latensi & status hidup controller, printer, kamera, endpoint.
- `log-output` – log level `error` ditampilkan real-time di dashboard.

## Alur Kerja

1. Controller mengirim trigger `:A` atau `:R` melalui TCP.
2. `processData` memanggil `cameraHandler` untuk mengambil gambar.
3. Gambar disimpan di `pictures/`, lalu diproses deteksi plat nomor.
4. Nomor tiket dibuat ke server, tiket dicetak, gate dibuka.

## Pembersihan Otomatis (Retensi)

| Data | Lokasi | Retensi | Ditangani oleh |
|------|--------|---------|----------------|
| Gambar (`.jpg/.jpeg/.png`) | `pictures/` | > 7 hari dihapus | [`services/cleanup.js`](services/cleanup.js) |
| Log (`app-*.log`) | `logs/` | > 30 hari dihapus | `winston-daily-rotate-file` (`maxFiles: '30d'`) di [`services/logger.js`](services/logger.js) |

Cleanup gambar:

- Dijalankan sekali saat aplikasi start, lalu diulang setiap 24 jam
  (`startCleanupSchedule()` dipanggil di `app.js`).
- Usia file dihitung dari waktu modifikasi (`mtime`).
- Hasil dicatat di log: `[CLEANUP] Selesai. Gambar dihapus: X`.

Log tidak dibersihkan di `cleanup.js` agar tidak overlap dengan rotasi winston.

### Fungsi (`cleanup.js`)

| Fungsi | Keterangan |
|--------|------------|
| `cleanOldPictures()` | Hapus gambar > 7 hari, return jumlah terhapus |
| `runCleanup()` | Jalankan cleanup gambar sekali dan catat hasil |
| `startCleanupSchedule()` | Jalankan saat startup + tiap 24 jam |

Mengubah retensi gambar: edit `PICTURE_RETENTION_DAYS` di `services/cleanup.js`.
Mengubah retensi log: edit `maxFiles` di `services/logger.js`.

Menjalankan manual:

```bash
node -e "require('./services/cleanup').runCleanup()"
```
