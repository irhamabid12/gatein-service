import socket
import threading
import json
from ultralytics import YOLO
import cv2
import time
import os

# =====================
# CONFIG
# =====================
PLATE_MODEL_PATH   = "/home/itki/Documents/RSDS/lisence-plate-test/best.pt"
VEHICLE_MODEL_PATH = "/home/itki/Downloads/vehicle-detection/best.pt"
RTSP_URL    = "rtsp://programmer:dev%402026@10.3.12.254:554/Streaming/Channels/101"
SAVE_DIR    = "/home/itki/Documents/Reseach/testing-model-plat-number-detection/public/img/plates"

CONFIDENCE = 0.5

# =====================
# TCP CONFIG — harus sama dengan PYTHON_TCP_PORT di processData.js
# =====================
TCP_HOST = "0.0.0.0"
TCP_PORT = 5005

# =====================
# INIT
# =====================
os.makedirs(SAVE_DIR, exist_ok=True)

print("[INFO] Load plate model...")
plate_model = YOLO(PLATE_MODEL_PATH)

print("[INFO] Load vehicle model...")
vehicle_model = YOLO(VEHICLE_MODEL_PATH)

# paksa pakai TCP (biar stabil RTSP)
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

# Global variable untuk menyimpan frame terbaru
latest_frame = None
frame_lock = threading.Lock()


def rtsp_reader():
    """
    Thread terpisah yang terus-menerus membaca frame dari RTSP.
    Frame terbaru selalu tersedia untuk diproses saat ada trigger.
    """
    global latest_frame
    print("[INFO] Connect ke RTSP...")
    cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)

    if not cap.isOpened():
        print("[ERROR] Tidak bisa connect RTSP")
        return

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[WARNING] Frame gagal, reconnect...")
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
    results = vehicle_model(frame, conf=CONFIDENCE)[0]

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
        print(f"[VEHICLE] Terdeteksi: {best_vehicle} | conf={best_conf:.2f}")
    else:
        print("[VEHICLE] Tidak ada kendaraan terdeteksi")

    return best_vehicle, best_conf


def run_detection(frame, trigger_data):
    """
    Menjalankan inferensi YOLO pada frame.
    1. Deteksi kategori kendaraan
    2. Deteksi plat nomor
    3. Simpan crop plat dengan nama file = kategori kendaraan
    Mengembalikan dict hasil deteksi untuk dikirim balik ke Node.js.
    """
    print(f"[INFO] Menjalankan deteksi (trigger: '{trigger_data}')...")

    # 1. Deteksi kategori kendaraan
    vehicle_category, vehicle_conf = detect_vehicle_category(frame)
    category_name = vehicle_category if vehicle_category else "unknown"

    # 2. Deteksi plat nomor
    results = plate_model(frame, conf=CONFIDENCE)[0]

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
            print(f"[SAVED] {filepath} | plate_conf={conf:.2f} | vehicle={category_name}")

            detected_plates.append({
                "file": filename,
                "confidence": round(conf, 2),
                "vehicle_category": category_name,
                "vehicle_confidence": round(vehicle_conf, 2)
            })

    return detected_plates


def handle_client(conn, addr):
    """
    Menangani satu koneksi TCP dari processData.js.
    - Terima trigger (:A atau :R)
    - Jalankan YOLO pada frame terbaru
    - Kirim respons JSON kembali ke Node.js
    """
    try:
        data = conn.recv(1024)
        if not data:
            return

        trigger_data = data.decode('utf-8', errors='ignore').strip()
        print(f"\n[TCP] Trigger diterima dari {addr}: '{trigger_data}'")

        # Ambil frame terbaru
        with frame_lock:
            frame_to_process = latest_frame.copy() if latest_frame is not None else None

        if frame_to_process is None:
            response = json.dumps({"status": "error", "message": "Frame belum tersedia"})
            conn.sendall(response.encode('utf-8'))
            return

        # Jalankan deteksi
        plates = run_detection(frame_to_process, trigger_data)

        if plates:
            response = json.dumps({
                "status": "ok",
                "trigger": trigger_data,
                "count": len(plates),
                "plates": plates
            })
        else:
            response = json.dumps({
                "status": "ok",
                "trigger": trigger_data,
                "count": 0,
                "plates": [],
                "message": "Tidak ada plat terdeteksi"
            })

        conn.sendall(response.encode('utf-8'))

    except Exception as e:
        print(f"[ERROR] handle_client: {e}")
        try:
            response = json.dumps({"status": "error", "message": str(e)})
            conn.sendall(response.encode('utf-8'))
        except:
            pass
    finally:
        conn.close()


# =====================
# STARTUP
# =====================

# 1. Mulai thread pembaca RTSP
rtsp_thread = threading.Thread(target=rtsp_reader, daemon=True)
rtsp_thread.start()

# 2. Tunggu sampai mendapatkan frame pertama
print("[INFO] Menunggu frame pertama dari RTSP...")
while latest_frame is None:
    time.sleep(0.1)
print("[INFO] Stream RTSP ready.")

# 3. Mulai TCP Server
server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server_socket.bind((TCP_HOST, TCP_PORT))
server_socket.listen(5)

print(f"[INFO] TCP Server aktif di {TCP_HOST}:{TCP_PORT}")
print("[INFO] Menunggu trigger dari Node.js (processData.js)...")

try:
    while True:
        conn, addr = server_socket.accept()
        # Handle setiap koneksi di thread terpisah agar tidak blocking
        client_thread = threading.Thread(target=handle_client, args=(conn, addr))
        client_thread.start()

except KeyboardInterrupt:
    print("\n[INFO] Server dihentikan.")
finally:
    server_socket.close()