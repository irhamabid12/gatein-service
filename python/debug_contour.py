import cv2
import numpy as np

img = cv2.imread('/home/itki/Documents/Reseach/testing-model-plat-number-detection/public/img/plates/car_20260429_142918.jpg')
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
h, w = gray.shape

blur = cv2.GaussianBlur(gray, (5,5), 0)
edged = cv2.Canny(blur, 50, 200)

contours, _ = cv2.findContours(edged, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]

for i, c in enumerate(contours):
    peri = cv2.arcLength(c, True)
    approx = cv2.approxPolyDP(c, 0.02 * peri, True)
    area = cv2.contourArea(approx)
    
    if len(approx) == 4:
        x, y, cw, ch = cv2.boundingRect(approx)
        if ch > 0:
            aspect = cw / ch
            print(f"Contour {i}: 4 points, area={area:.1f} ({area/(h*w)*100:.1f}%), aspect={aspect:.2f}")
    else:
        print(f"Contour {i}: {len(approx)} points, area={area:.1f} ({area/(h*w)*100:.1f}%)")
