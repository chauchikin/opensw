# The manual's screenshots (scripts/manual-shots.mjs): a grey frame round each, then 256 colours to keep
# the files small.  python3 scripts/manual-shots.py public/manual   (needs Pillow)
import os, sys
from PIL import Image, ImageOps

root = sys.argv[1]
for lang in os.listdir(root):
    for f in os.listdir(os.path.join(root, lang)):
        if not f.endswith('.png'):
            continue
        path = os.path.join(root, lang, f)
        im = Image.open(path).convert('RGB')
        if im.getpixel((0, 0)) != (150, 150, 150):  # not framed yet
            im = ImageOps.expand(im, border=1, fill=(150, 150, 150))
        method = Image.Quantize.FASTOCTREE if f.startswith('plot') else Image.Quantize.MEDIANCUT
        im.quantize(colors=256, method=method, dither=Image.Dither.NONE).save(path, optimize=True)
