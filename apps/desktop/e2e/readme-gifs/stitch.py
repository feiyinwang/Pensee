# Stitches a scene's timestamped frames (NNNN-<ms>.png, from scenes.spec.js)
# into a GIF at their real pace. Gaps are clamped, so a wait on the AI doesn't
# stall the GIF; the first and last frames are held so the eye can read them.
#
#   stitch.py FRAMES_DIR OUT.gif --width 1200 [--crop L,T,R,B] [--until MARK] [--gap MS]
#
# --crop is in CSS pixels of the page (R and B may be "end"), or @name for a
#   box the spec measured (saveRegion, regions.json); each frame's own scale
#   comes from the viewport.json the spec writes beside them.
# --until stops before the frame the spec marked with that name (marks.json).
# --gap keeps at most one frame per MS milliseconds.
import argparse, json, os, sys
from PIL import Image, features

ap = argparse.ArgumentParser()
ap.add_argument("frames_dir")
ap.add_argument("out")
ap.add_argument("--width", type=int, required=True)
ap.add_argument("--crop")
ap.add_argument("--until")
ap.add_argument("--gap", type=int, default=0)
args = ap.parse_args()

files = sorted(f for f in os.listdir(args.frames_dir) if f.endswith(".png"))
if not files:
    raise SystemExit(f"no frames in {args.frames_dir}")
if args.until:
    with open(os.path.join(args.frames_dir, "marks.json")) as f:
        marks = json.load(f)
    if args.until not in marks:
        raise SystemExit(f"no mark {args.until!r} in marks.json: {sorted(marks)}")
    files = files[: marks[args.until]]

keep, last = [], None
for f in files:
    t = int(f.split("-")[1][:-4])
    if last is None or t - last >= args.gap or f == files[-1]:
        keep.append(f)
        last = t
files = keep
ts = [int(f.split("-")[1][:-4]) for f in files]

# Crop edges in CSS pixels, scaled per frame: a run can switch screens (or
# the screen its scale) partway, and its frames then change size.
edges = None
if args.crop:
    with open(os.path.join(args.frames_dir, "viewport.json")) as f:
        css_width = json.load(f)["width"]
    if args.crop.startswith("@"):
        with open(os.path.join(args.frames_dir, "regions.json")) as f:
            edges = [str(v) for v in json.load(f)[args.crop[1:]]]
    else:
        edges = args.crop.split(",")
    if len(edges) != 4:
        raise SystemExit("--crop takes L,T,R,B")


def crop(im):
    if not edges:
        return im
    scale = im.width / css_width
    full = (None, None, im.width, im.height)
    return im.crop(tuple(full[i] if v == "end" else int(float(v) * scale) for i, v in enumerate(edges)))


images = []
size = None
for f in files:
    im = crop(Image.open(os.path.join(args.frames_dir, f)).convert("RGB"))
    size = size or (args.width, round(im.height * args.width / im.width))
    images.append(im.resize(size, Image.LANCZOS))
durations = [min(max(b - a, 60), 350) for a, b in zip(ts, ts[1:])] + [2200]
durations[0] = max(durations[0], 700)
# Drop frames identical to the one before, adding their time to it.
kept, kept_d = [images[0]], [durations[0]]
for im, d in zip(images[1:], durations[1:]):
    if im.tobytes() == kept[-1].tobytes():
        kept_d[-1] = min(kept_d[-1] + d, 1200)
    else:
        kept.append(im)
        kept_d.append(d)
kept_d[-1] = 2200
# One palette for every frame, from a strip of frames across the clip, so
# unchanged pixels keep their index and each frame stores only what moved
# (the book GIF went from 3.1 MB with a palette per frame to 0.28 MB).
# libimagequant weighs colours by how they look, so a face in a mostly grey
# video keeps its skin tones; median cut splits by pixel count and gives them
# a few flat patches. Pillow builds without it fall back to median cut.
sample = kept[:: max(1, len(kept) // 24)]
strip = Image.new("RGB", (sample[0].width, sample[0].height * len(sample)))
for i, im in enumerate(sample):
    strip.paste(im, (0, i * im.height))
if features.check_feature("libimagequant"):
    method = Image.Quantize.LIBIMAGEQUANT
else:
    print("stitch.py: Pillow has no libimagequant; colours in video may band", file=sys.stderr)
    method = Image.Quantize.MEDIANCUT
master = strip.quantize(colors=256, method=method, dither=Image.Dither.NONE)
pal = [im.quantize(palette=master, dither=Image.Dither.NONE) for im in kept]
pal[0].save(args.out, save_all=True, append_images=pal[1:], duration=kept_d, loop=0, optimize=True, disposal=1)
print(
    os.path.basename(args.out),
    f"{kept[0].width}x{kept[0].height}",
    len(kept), "frames",
    round(sum(kept_d) / 1000, 1), "s",
    round(os.path.getsize(args.out) / 1e6, 2), "MB",
)
