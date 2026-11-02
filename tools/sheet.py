# Contact sheet: python3 tools/sheet.py out.jpg cols width img1 img2 ...
import sys
from PIL import Image, ImageDraw
out, cols, width = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = [Image.open(p).convert('RGB') for p in sys.argv[4:]]
w = width // cols
h = int(ims[0].height * w / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, (im, p) in enumerate(zip(ims, sys.argv[4:])):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    d.text((x + 6, y + 4), p.split('/')[-1], fill=(255, 255, 0))
sheet.save(out, quality=88)
