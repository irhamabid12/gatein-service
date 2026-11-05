import cv2
import re
import easyocr

img = cv2.imread('/home/itki/Documents/Reseach/testing-model-plat-number-detection/public/img/plates/car_20260429_143417.jpg')
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# threshold
_, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)

# gray_blur = cv2.GaussianBlur(gray, (5,5), 0)
# _, thresh = cv2.threshold(gray_blur, 150, 255, cv2.THRESH_BINARY)

# thresh = cv2.adaptiveThreshold(
#     gray, 255,
#     cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
#     cv2.THRESH_BINARY,
#     11, 2
# )

cv2.imwrite('processed.jpg', thresh)

reader = easyocr.Reader(['en'])

# OCR pada gambar yang sudah di-threshold
results = reader.readtext(thresh, detail=1)

print("=== RAW OCR RESULTS ===")
for (bbox, text, conf) in results:
    print(f"  '{text}' (conf={conf:.2f})")

# Gabungkan semua teks OCR jadi satu string
raw_text = " ".join([text for (_, text, _) in results])
print(f"\n[RAW] Gabungan: '{raw_text}'")

# Bersihkan: hanya ambil huruf dan angka
cleaned = re.sub(r'[^A-Za-z0-9]', '', raw_text).upper()
print(f"[CLEANED] '{cleaned}'")


def format_plat_indonesia(text):
    """
    Format plat nomor Indonesia: [HURUF] [ANGKA] [HURUF]
    Contoh: B 1234 ABC, D 5678 XY, AG 1234 AB, TR 8272 XX
    
    Pola umum:
    - 1-2 huruf (kode wilayah)
    - 1-4 angka (nomor)
    - 0-3 huruf (seri akhir)
    """
    # Cari pola plat Indonesia: huruf(1-2) + angka(1-4) + huruf(0-3)
    match = re.match(r'^([A-Z]{1,2})(\d{1,4})([A-Z]{0,3})$', text)
    
    if match:
        kode_wilayah = match.group(1)
        nomor = match.group(2)
        seri_akhir = match.group(3)
        
        if seri_akhir:
            return f"{kode_wilayah} {nomor} {seri_akhir}"
        else:
            return f"{kode_wilayah} {nomor}"
    
    # Fallback: coba pisahkan manual (huruf-angka-huruf)
    huruf_depan = ""
    angka = ""
    huruf_belakang = ""
    
    state = "huruf_depan"  # mulai cari huruf depan
    
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
    
    return text  # kembalikan apa adanya jika gagal parse


plat = format_plat_indonesia(cleaned)
print(f"\n{'='*30}")
print(f"[RESULT] Plat Indonesia: {plat}")
print(f"{'='*30}")
