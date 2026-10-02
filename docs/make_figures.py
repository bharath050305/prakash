"""Prepares report figures: compresses screenshots and draws the architecture diagrams."""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, "screenshots"), os.path.join(HERE, "report_img")
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(SRC):
    im = Image.open(os.path.join(SRC, f)).convert("RGB")
    im.thumbnail((1500, 1500))
    im.save(os.path.join(OUT, f.replace(".png", ".jpg")), quality=84, optimize=True)

FONT = r"C:\Windows\Fonts\segoeui.ttf"
BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
F = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
INK, AMB, BLUE, GREEN, VIO, GRAY = "#0F1A2E", "#F5A00B", "#2A66E0", "#0F8A72", "#6B4FD3", "#E9EDF4"


def box(d, xy, title, lines, fill, tc="white", fs=22):
    x0, y0, x1, y1 = xy
    d.rounded_rectangle(xy, 16, fill=fill)
    d.text((x0 + 18, y0 + 14), title, font=F(fs + 2, True), fill=tc)
    for i, l in enumerate(lines):
        d.text((x0 + 18, y0 + 52 + i * 28), l, font=F(fs - 3), fill=tc)


def arrow(d, a, b, col=INK):
    d.line([a, b], fill=col, width=4)
    x, y = b
    if abs(b[0] - a[0]) >= abs(b[1] - a[1]):
        s = 1 if b[0] > a[0] else -1
        d.polygon([(x, y), (x - 14 * s, y - 8), (x - 14 * s, y + 8)], fill=col)
    else:
        s = 1 if b[1] > a[1] else -1
        d.polygon([(x, y), (x - 8, y - 14 * s), (x + 8, y - 14 * s)], fill=col)


# ---- Figure: five-stage pipeline / system architecture
W, H = 2000, 1150
im = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(im)
d.text((W // 2, 34), "Prakash: system architecture", font=F(38, True), fill=INK, anchor="mm")
stages = [
    ("1. Collect", ["WhatsApp · SMS", "Email · X / Twitter", "Call transcripts", "Web portal + photo + GPS", "Bulk CSV import"], "#475569"),
    ("2. Understand", ["Text clean-up", "Language ID (4 langs)", "TF-IDF + LogReg (8 classes)", "NER (rules + gazetteer)", "Severity score 0-100"], BLUE),
    ("3. Locate (GIS)", ["Geocode landmark / GPS", "Pole-ID lookup", "Snap to nearest lamp", "Duplicate merge"], GREEN),
    ("4. Predict & decide", ["DBSCAN hotspots", "Gradient-boosted risk", "Holt weekly forecast", "Route optimiser"], VIO),
    ("5. Act", ["Live dashboard + alerts", "Auto-dispatch (critical)", "Technician route", "Citizen auto-reply"], "#B36B00"),
]
bw, gap, x = 330, 60, 40
for i, (t, ls, c) in enumerate(stages):
    box(d, (x, 120, x + bw, 470), t, ls, c)
    if i: arrow(d, (x - gap + 6, 295), (x - 6, 295))
    x += bw + gap
# data + services layer
d.rounded_rectangle((40, 560, 1960, 760), 18, fill=GRAY)
d.text((70, 575), "Backend services (Python · Flask)", font=F(26, True), fill=INK)
svc = ["REST API + role checks", "Ingest pipeline", "Ticket life cycle", "Alert engine", "SSE live stream", "Webhooks /api/intake/*"]
sx = 70
for s in svc:
    w = d.textlength(s, font=F(20)) + 36
    d.rounded_rectangle((sx, 640, sx + w, 690), 12, fill="white", outline="#CBD3DF", width=2)
    d.text((sx + 18, 652), s, font=F(20), fill=INK); sx += w + 16
d.text((70, 710), "SQLite (WAL): users · technicians · lamps · tickets · events · reports · notifications · corrections · audit · settings", font=F(20), fill="#5B677C")
for i in range(5):
    arrow(d, (205 + i * 390, 470), (205 + i * 390, 556))
# roles
d.text((W // 2, 820), "Role-based browser interface (Leaflet · Chart.js · JavaScript modules)", font=F(26, True), fill=INK, anchor="mm")
roles = [("Citizen", "Report · live AI preview · track · rate", BLUE), ("Technician", "Optimised route · start / fix · shift", "#B36B00"), ("Admin", "Dashboard · review · NLP lab · hotspots · prediction · scheduling · models", "#C9342F")]
rx = 40
for t, s, c in roles:
    w = 600 if t != "Admin" else 740
    d.rounded_rectangle((rx, 870, rx + w - 20, 1060), 16, fill=c)
    d.text((rx + 20, 886), t, font=F(30, True), fill="white")
    # wrap
    words, line, y = s.split(), "", 940
    for wd in words:
        if d.textlength(line + wd, font=F(21)) > w - 70:
            d.text((rx + 20, y), line, font=F(21), fill="white"); y += 30; line = ""
        line += wd + " "
    d.text((rx + 20, y), line, font=F(21), fill="white")
    rx += w
arrow(d, (W // 2, 770), (W // 2, 810))
d.text((W // 2, 1100), "Human review loop: low-confidence tickets go to the review queue; corrections are stored and used to retrain the classifier.", font=F(21), fill="#5B677C", anchor="mm")
im.save(os.path.join(OUT, "d1_architecture.jpg"), quality=90)

# ---- Figure: ticket life cycle
W, H = 2000, 560
im = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(im)
d.text((W // 2, 34), "Ticket life cycle", font=F(36, True), fill=INK, anchor="mm")
nodes = [("Received", 60, 200, "#475569"), ("Review", 460, 80, VIO), ("Open", 460, 330, BLUE), ("Assigned", 860, 330, "#B36B00"), ("In progress", 1260, 330, "#D0620A"), ("Resolved", 1660, 330, GREEN), ("Rejected", 860, 80, "#8A94A6")]
pos = {}
for t, x, y, c in nodes:
    d.rounded_rectangle((x, y, x + 280, y + 110), 20, fill=c)
    d.text((x + 140, y + 55), t, font=F(30, True), fill="white", anchor="mm"); pos[t] = (x, y)
def mid(t, side):
    x, y = pos[t]
    return {"r": (x + 280, y + 55), "l": (x, y + 55), "t": (x + 140, y), "b": (x + 140, y + 110)}[side]
arrow(d, mid("Received", "r"), (460, 135)); arrow(d, (340, 255), (460, 385))
arrow(d, mid("Open", "r"), mid("Assigned", "l")); arrow(d, mid("Assigned", "r"), mid("In progress", "l")); arrow(d, mid("In progress", "r"), mid("Resolved", "l"))
arrow(d, (600, 192), (600, 328)); arrow(d, mid("Review", "r"), mid("Rejected", "l"))
d.text((340, 150), "unsure", font=F(20), fill=VIO); d.text((290, 345), "confident", font=F(20), fill=BLUE)
d.text((612, 240), "admin releases", font=F(20), fill=VIO)
d.text((1000, 470), "Critical tickets skip waiting: auto-dispatched from Open straight to Assigned.", font=F(22), fill="#5B677C", anchor="mm")
d.text((1000, 515), "Duplicate reports never create a new ticket: they are merged into the live one and raise its priority.", font=F(22), fill="#5B677C", anchor="mm")
im.save(os.path.join(OUT, "d2_lifecycle.jpg"), quality=90)
print(sorted(os.listdir(OUT))[:5], len(os.listdir(OUT)))
