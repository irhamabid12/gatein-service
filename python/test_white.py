import cv2
import pytesseract
import re
import numpy as np

def clean_plate_text(text):
    return re.sub(r'[^A-Z0-9]', '', text).upper()

def order_points(pts):
    """Mengurutkan 4 titik sudut: top-left, top-right, bottom-right, bottom-left"""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)] # Top-left: jumlah koordinat terkecil
    rect[2] = pts[np.argmax(s)] # Bottom-right: jumlah koordinat terbesar
    
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)] # Top-right: selisih x-y terkecil
    rect[3] = pts[np.argmax(diff)] # Bottom-left: selisih x-y terbesar
    return rect

def get_perspective_warp(image, pts):
    """Meluruskan geometri plat berdasarkan 4 titik sudut"""
    rect = order_points(pts)
    (tl, tr, br, bl) = rect
    
    # Hitung lebar baru (ambil max antara lebar atas dan bawah)
    width_a = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    width_b = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    new_width = max(int(width_a), int(width_b))
    
    # Hitung tinggi baru (ambil max antara tinggi kanan dan kiri)
    height_a = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    height_b = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    new_height = max(int(height_a), int(height_b))
    
    # Set titik tujuan untuk warp (persegi panjang datar)
    dst = np.array([
        [0, 0],
        [new_width - 1, 0],
        [new_width - 1, new_height - 1],
        [0, new_height - 1]], dtype="float32")
    
    # Hitung matriks warp dan terapkan
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, M, (new_width, new_height))
    return warped

def ensure_black_on_white(img):
    """Pastikan teks HITAM di background PUTIH (kebutuhan Tesseract)"""
    mid_h, mid_w = img.shape[:2]
    mean_val = np.mean(img[int(mid_h*0.3):int(mid_h*0.7), int(mid_w*0.3):int(mid_w*0.7)])
    if mean_val < 127:
        return cv2.bitwise_not(img)
    return img

def find_plate_contour(gray_img, img_area):
    """Cari kontur plat dengan multiple strategi — handles plat hitam & putih."""
    
    def filter_plate_contours(contour_list):
        """Filter kontur berdasarkan aspect ratio plat & area minimum."""
        for c in contour_list:
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) == 4:
                x, y, cw, ch = cv2.boundingRect(approx)
                if ch == 0:
                    continue
                aspect = cw / ch
                area = cv2.contourArea(approx)
                # Plat nomor: aspect ratio ~2:1 sampai 7:1, area minimal 5% gambar
                # Area minimal dinaikkan supaya tidak menangkap kontur kecil/strip
                if 2.0 <= aspect <= 7.0 and area > img_area * 0.05:
                    return approx
        return None

    strategies = []
    
    # Strategi 1: Canny standar
    blur1 = cv2.GaussianBlur(gray_img, (5, 5), 0)
    edged1 = cv2.Canny(blur1, 50, 200)
    strategies.append(('canny_standard', edged1))
    
    # Strategi 2: Canny + Dilate (sambung tepi yang putus — bagus untuk plat hitam)
    kernel_d = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    dilated1 = cv2.dilate(edged1, kernel_d, iterations=2)
    strategies.append(('canny_dilated', dilated1))
    
    # Strategi 3: Canny dengan threshold rendah (lebih sensitif)
    edged2 = cv2.Canny(blur1, 30, 100)
    dilated2 = cv2.dilate(edged2, kernel_d, iterations=2)
    strategies.append(('canny_low_thresh', dilated2))
    
    # Strategi 4: Adaptive threshold (bagus untuk kontras rendah plat hitam)
    blur2 = cv2.GaussianBlur(gray_img, (7, 7), 0)
    adapt = cv2.adaptiveThreshold(blur2, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY_INV, 25, 10)
    kernel_d2 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    adapt_dilated = cv2.dilate(adapt, kernel_d2, iterations=2)
    strategies.append(('adaptive_thresh', adapt_dilated))
    
    # Strategi 5: Morphological gradient (deteksi tepi via morfologi)
    morph_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    gradient = cv2.morphologyEx(blur1, cv2.MORPH_GRADIENT, morph_kernel)
    _, grad_bin = cv2.threshold(gradient, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    grad_dilated = cv2.dilate(grad_bin, kernel_d, iterations=2)
    strategies.append(('morph_gradient', grad_dilated))

    for strategy_name, edge_img in strategies:
        cv2.imwrite(f'debug_edge_{strategy_name}.jpg', edge_img)
        # Gunakan RETR_LIST agar kontur dalam juga terdeteksi (plat hitam di mobil hitam)
        contours, _ = cv2.findContours(edge_img, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:20]
        
        result = filter_plate_contours(contours)
        if result is not None:
            print(f"[INFO] Plat ditemukan dengan strategi: {strategy_name}")
            return result
    
    return None

def run_ocr_pipeline(plate_gray, crop_top_pct=0.65, label=""):
    """Pipeline OCR: upscale -> denoise -> threshold -> OCR dengan multiple metode.
    
    Args:
        plate_gray: Gambar grayscale plat yang sudah di-warp/crop
        crop_top_pct: Persentase atas gambar yang diambil (untuk buang baris kedua)
        label: Label untuk debug print
    
    Returns:
        tuple: (best_result, best_method, all_results)
    """
    # Crop baris utama plat (buang baris kedua "C3 31" dll)
    ph, pw = plate_gray.shape[:2]
    if crop_top_pct < 1.0:
        cropped = plate_gray[0:int(ph * crop_top_pct), :]
    else:
        cropped = plate_gray
    cv2.imwrite('debug_02_cropped.jpg', cropped)
    
    # Upscale 4x agar Tesseract lebih akurat
    scale_factor = 4
    large = cv2.resize(cropped, None, fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_CUBIC)
    cv2.imwrite('debug_03_upscaled.jpg', large)
    
    # Bilateral Filter — mengurangi noise TANPA merusak tepi karakter
    denoised = cv2.bilateralFilter(large, 11, 75, 75)
    cv2.imwrite('debug_04_denoised.jpg', denoised)
    
    # Siapkan multiple thresholding methods
    # Adaptive Gaussian
    binary_adapt = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 21, 10
    )
    cv2.imwrite('debug_05_adaptive.jpg', binary_adapt)
    
    # Otsu
    _, binary_otsu = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    cv2.imwrite('debug_05b_otsu.jpg', binary_otsu)
    
    # Pastikan teks hitam di background putih
    binary_adapt = ensure_black_on_white(binary_adapt)
    binary_otsu = ensure_black_on_white(binary_otsu)
    
    # Erosi ringan — menipiskan karakter tebal
    kernel_erode = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    eroded_adapt = cv2.erode(binary_adapt, kernel_erode, iterations=1)
    eroded_otsu = cv2.erode(binary_otsu, kernel_erode, iterations=1)
    cv2.imwrite('debug_06_eroded_adapt.jpg', eroded_adapt)
    cv2.imwrite('debug_06_eroded_otsu.jpg', eroded_otsu)

    # Semua kandidat OCR
    candidates = {
        'adaptive': binary_adapt,
        'adaptive+erode': eroded_adapt,
        'otsu': binary_otsu,
        'otsu+erode': eroded_otsu,
    }
    
    # Regex format plat Indonesia: 1-2 huruf + 1-4 angka + 1-3 huruf
    plate_pattern = re.compile(r'^[A-Z]{1,2}\d{1,4}[A-Z]{1,3}$')
    
    best_result = None
    best_method = None
    all_results = {}
    
    for method_name, img_candidate in candidates.items():
        # Tambahkan margin putih
        bordered = cv2.copyMakeBorder(img_candidate, 30, 30, 30, 30, 
                                       cv2.BORDER_CONSTANT, value=[255, 255, 255])
        
        # OCR PSM 7 (single text line)
        config = r'--oem 3 --psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        raw = pytesseract.image_to_string(bordered, config=config)
        cleaned = clean_plate_text(raw)
        all_results[method_name] = cleaned
        
        # Pilih hasil yang cocok format plat Indonesia
        if plate_pattern.match(cleaned) and best_result is None:
            best_result = cleaned
            best_method = method_name
            cv2.imwrite('debug_perspective.jpg', bordered)
    
    # Fallback: pilih hasil terpanjang yang masuk akal
    if best_result is None:
        longest = max(all_results.items(), key=lambda x: len(x[1]), default=('', ''))
        best_result = longest[1]
        best_method = f'{longest[0]} (fallback)'
        if longest[0] in candidates:
            bordered = cv2.copyMakeBorder(candidates[longest[0]], 30, 30, 30, 30,
                                           cv2.BORDER_CONSTANT, value=[255, 255, 255])
            cv2.imwrite('debug_perspective.jpg', bordered)
    
    return best_result, best_method, all_results


# ==================== MAIN ====================

# 1. Load Gambar
path_img = '/home/itki/Documents/Reseach/testing-model-plat-number-detection/public/img/plates/car_20260429_142918.jpg' 
img = cv2.imread(path_img)
h, w = img.shape[:2]

# 2. Preprocessing
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# 3. Cari kontur plat
plate_cnt = find_plate_contour(gray, h * w)

if plate_cnt is not None:
    # 4a. Kontur ditemukan -> Warp Perspective
    warped = get_perspective_warp(gray, plate_cnt.reshape(4, 2))
    cv2.imwrite('debug_01_warped.jpg', warped)
    
    # Validasi: pastikan warped image cukup besar (bukan strip kecil)
    wh, ww = warped.shape[:2]
    warp_aspect = ww / wh if wh > 0 else 0
    
    if wh > 10 and ww > 30 and 1.5 <= warp_aspect <= 8.0:
        print(f"[INFO] Menggunakan perspective warp ({ww}x{wh}, aspect={warp_aspect:.1f})")
        plate_img = warped
        crop_pct = 0.65  # Crop baris kedua
    else:
        # Warp terlalu kecil/strip -> fallback ke gambar penuh
        print(f"[INFO] Warp tidak valid ({ww}x{wh}), fallback ke gambar penuh")
        plate_img = gray
        crop_pct = 1.0  # Jangan crop
else:
    # 4b. Kontur tidak ditemukan -> gunakan seluruh gambar langsung
    # Ini terjadi pada gambar yang sudah di-crop oleh YOLO
    print("[INFO] Kontur plat tidak ditemukan, menggunakan gambar penuh (YOLO crop)")
    plate_img = gray
    crop_pct = 0.70  # Tetap crop sedikit bawah untuk buang noise
    cv2.imwrite('debug_01_warped.jpg', gray)

# 5. Jalankan OCR Pipeline
best_result, best_method, all_results = run_ocr_pipeline(plate_img, crop_pct)

# 6. Print hasil
print("\n" + "="*40)
print("SEMUA KANDIDAT OCR:")
for method_name, result_text in all_results.items():
    marker = " <<<" if method_name in (best_method or '') else ""
    print(f"  {method_name:20s}: {result_text}{marker}")
print("-"*40)
print(f"METODE TERBAIK : {best_method}")
print(f"HASIL AKHIR    : {best_result}")
print("="*40)