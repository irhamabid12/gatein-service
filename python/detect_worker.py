import sys
import threading
import json
from ultralytics import YOLO
import cv2
import time
import os
import re
import easyocr

# =====================
# CONFIG
# =====================
PLATE_MODEL_PATH   = "/home/itki/Documents/RSDS/lisence-plate-test/best.pt"
# VEHICLE_MODEL_PATH = "/home/itki/Downloads/vehicle-detection/best.pt"
# Defaulting to plate model for both if vehicle model is not found, or user can fix it
VEHICLE_MODEL_PATH = "/home/itki/Documents/RSDS/vehicle-detection/best.pt"
RTSP_URL    = "rtsp://programmer:dev%402026@10.3.12.254:554/Streaming/Channels/101"
SAVE_DIR    = "/home/itki/Documents/Reseach/testing-model-plat-number-detection/public/img/plates"

CONFIDENCE = 0.5

# =====================
# INIT
# =====================
os.makedirs(SAVE_DIR, exist_ok=True)

def log_err(msg):
    # Log ke stderr agar tidak mengganggu JSON stdout
    print(msg, file=sys.stderr, flush=True)

log_err("[INFO] Load plate model...")
plate_model = YOLO(PLATE_MODEL_PATH)

log_err("[INFO] Load vehicle model...")
try:
    vehicle_model = YOLO(VEHICLE_MODEL_PATH)
except Exception as e:
    log_err(f"[ERROR] Failed to load vehicle model: {e}")
    vehicle_model = None

# paksa pakai TCP (biar stabil RTSP)
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

# Global variable untuk menyimpan frame terbaru
latest_frame = None
frame_lock = threading.Lock()

log_err("[INFO] Load OCR model...")
try:
    reader = easyocr.Reader(['en'])
except Exception as e:
    log_err(f"[ERROR] Failed to load OCR model: {e}")
    reader = None

def format_plat_indonesia(text):
    """
    Format plat nomor Indonesia: [HURUF] [ANGKA] [HURUF]
    """
    match = re.match(r'^([A-Z]{1,2})(\d{1,4})([A-Z]{0,3})$', text)
    
    if match:
        kode_wilayah = match.group(1)
        nomor = match.group(2)
        seri_akhir = match.group(3)
        
        if seri_akhir:
            return f"{kode_wilayah} {nomor} {seri_akhir}"
        else:
            return f"{kode_wilayah} {nomor}"
            
    huruf_depan = ""
    angka = ""
    huruf_belakang = ""
    state = "huruf_depan"
    
    for ch in text:
        if state == "huruf_depan":
            if ch.isalpha():
                huruf_depan += ch
            elif ch.isdigit():
                angka += ch
                state = "angka"
        elif state == "angka":
            if ch.isdigit():
                angka += ch
            elif ch.isalpha():
                huruf_belakang += ch
                state = "huruf_belakang"
        elif state == "huruf_belakang":
            if ch.isalpha():
                huruf_belakang += ch
                
    parts = [p for p in [huruf_depan, angka, huruf_belakang] if p]
    if parts:
        return " ".join(parts)
        
    return text


def rtsp_reader():
    """
    Thread terpisah yang terus-menerus membaca frame dari RTSP.
    Frame terbaru selalu tersedia untuk diproses saat ada trigger.
    """
    global latest_frame
    log_err("[INFO] Connect ke RTSP...")
    cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)

    if not cap.isOpened():
        log_err("[ERROR] Tidak bisa connect RTSP")
        return

    while True:
        ret, frame = cap.read()
        if not ret:
            log_err("[WARNING] Frame gagal, reconnect...")
            cap.release()
            time.sleep(2)
            cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)
            continue

        with frame_lock:
            latest_frame = frame


def detect_vehicle_category(frame):
    """
    Deteksi kategori kendaraan pada frame menggunakan vehicle model.
    Mengembalikan nama kategori kendaraan dengan confidence tertinggi.
    """
    if vehicle_model is None:
        return None, 0.0
        
    results = vehicle_model(frame, conf=CONFIDENCE, verbose=False)[0]

    best_vehicle = None
    best_conf = 0.0

    for box in results.boxes:
        cls_id = int(box.cls[0])
        label = vehicle_model.names[cls_id]
        conf = float(box.conf[0])

        if conf > best_conf:
            best_conf = conf
            best_vehicle = label

    if best_vehicle:
        # Bersihkan nama kategori agar aman untuk nama file
        best_vehicle = best_vehicle.strip().replace(" ", "_").lower()
    
    return best_vehicle, best_conf


def run_detection(frame, trigger_data):
    """
    Menjalankan inferensi YOLO pada frame.
    """
    # 1. Deteksi kategori kendaraan
    vehicle_category, vehicle_conf = detect_vehicle_category(frame)
    category_name = vehicle_category if vehicle_category else "unknown"

    # 2. Deteksi plat nomor
    results = plate_model(frame, conf=CONFIDENCE, verbose=False)[0]

    detected_plates = []

    for box in results.boxes:
        cls_id = int(box.cls[0])
        label = plate_model.names[cls_id]
        conf = float(box.conf[0])

        if label == "license_plate" and conf > CONFIDENCE:
            x1, y1, x2, y2 = map(int, box.xyxy[0])

            # padding
            pad = 10
            h, w, _ = frame.shape
            x1 = max(0, x1 - pad)
            y1 = max(0, y1 - pad)
            x2 = min(w, x2 + pad)
            y2 = min(h, y2 + pad)

            crop = frame[y1:y2, x1:x2]

            # 3. Nama file = kategori_timestamp.jpg
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            filename = f"{category_name}_{timestamp}.jpg"
            filepath = f"{SAVE_DIR}/{filename}"

            cv2.imwrite(filepath, crop)

            # --- OCR ---
            plate_number = ""
            if reader is not None:
                gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                _, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
                
                ocr_results = reader.readtext(thresh, detail=1)
                raw_text = " ".join([text for (_, text, _) in ocr_results])
                cleaned = re.sub(r'[^A-Za-z0-9]', '', raw_text).upper()
                plate_number = format_plat_indonesia(cleaned)
            # ---------

            detected_plates.append({
                "file": filename,
                "confidence": round(conf, 2),
                "vehicle_category": category_name,
                "vehicle_confidence": round(vehicle_conf, 2),
                "plate_number": plate_number
            })

    return detected_plates


# =====================
# STARTUP
# =====================

log_err("[INFO] Worker siap. Menunggu perintah via stdin...")

# Signal ke stdout bahwa worker siap
print(json.dumps({"status": "ready"}), flush=True)

try:
    for line in sys.stdin:
        line_data = line.strip()
        if not line_data:
            continue
            
        try:
            req = json.loads(line_data)
            trigger_data = req.get("trigger", "unknown")
            image_path = req.get("image_path")
        except json.JSONDecodeError:
            log_err(f"[ERROR] Format tidak valid: {line_data}")
            continue
            
        log_err(f"\n[WORKER] Memproses trigger: '{trigger_data}', image: {image_path}")

        if not image_path or not os.path.exists(image_path):
            response = {"status": "error", "message": f"Gambar tidak ditemukan: {image_path}"}
            print(json.dumps(response), flush=True)
            continue

        frame_to_process = cv2.imread(image_path)

        if frame_to_process is None:
            response = {"status": "error", "message": "Gagal membaca gambar"}
            print(json.dumps(response), flush=True)
            continue

        # Jalankan deteksi
        try:
            plates = run_detection(frame_to_process, trigger_data)

            if plates:
                response = {
                    "status": "ok",
                    "trigger": trigger_data,
                    "count": len(plates),
                    "plates": plates
                }
            else:
                response = {
                    "status": "ok",
                    "trigger": trigger_data,
                    "count": 0,
                    "plates": [],
                    "message": "Tidak ada plat terdeteksi"
                }
            
            # Print hasil sebagai JSON satu baris ke stdout
            print(json.dumps(response), flush=True)
            
        except Exception as e:
            log_err(f"[ERROR] run_detection error: {e}")
            response = {"status": "error", "message": str(e)}
            print(json.dumps(response), flush=True)

except KeyboardInterrupt:
    log_err("\n[INFO] Worker dihentikan.") 
