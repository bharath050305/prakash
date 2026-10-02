"""GIS helpers: the city model (zones, landmarks, lamp network) and distance maths.

Coordinates are approximate real positions in Navi Mumbai. The lamp network itself is
synthetic (generated along road corridors) because no municipal asset register is available.
"""
import math
import random

# ---------------------------------------------------------------- zones
# re: regex (English + Devanagari aliases) used by the NER step.
ZONES = [
    dict(id="airoli", code="AIR", name="Airoli", lat=19.1560, lng=72.9990, w=0.9,
         station=(19.1586, 72.9988), re=r"airoli|ऐरोली"),
    dict(id="ghansoli", code="GHA", name="Ghansoli", lat=19.1150, lng=73.0065, w=1.0,
         station=(19.1147, 73.0071), re=r"ghansoli|घनसोली"),
    dict(id="vashi", code="VSH", name="Vashi", lat=19.0700, lng=72.9990, w=1.2,
         station=(19.0634, 72.9986), re=r"vashi|वाशी"),
    dict(id="sanpada", code="SNP", name="Sanpada", lat=19.0640, lng=73.0100, w=1.1,
         station=(19.0657, 73.0093), re=r"sanpada|सानपाडा"),
    dict(id="nerul", code="NER", name="Nerul", lat=19.0330, lng=73.0190, w=1.4,
         station=(19.0331, 73.0186), re=r"nerul|नेरुल|नेरूळ"),
    dict(id="seawoods", code="SEA", name="Seawoods", lat=19.0210, lng=73.0180, w=0.8,
         station=(19.0190, 73.0180), re=r"seawoods|सीवुड्स|सीवूड्स"),
    dict(id="belapur", code="BEL", name="Belapur", lat=19.0170, lng=73.0380, w=0.9,
         station=(19.0190, 73.0391), re=r"belapur|बेलापुर|बेलापूर"),
    dict(id="kharghar", code="KHR", name="Kharghar", lat=19.0480, lng=73.0700, w=1.2,
         station=(19.0500, 73.0640), re=r"kharghar|खारघर"),
]
ZM = {z["id"]: z for z in ZONES}

# (display name, regex, zone id, lat, lng)
LANDMARKS = [
    ("SIES College", r"\bsies( college| graduate school)?( nerul)?", "nerul", 19.0410, 73.0165),
    ("DY Patil Stadium", r"d\.?\s?y\.?\s?patil( stadium)?", "nerul", 19.0433, 73.0269),
    ("Inorbit Mall", r"(vashi\s+)?inorbit( mall)?", "vashi", 19.0655, 73.0011),
    ("APMC Market", r"apmc( market)?", "vashi", 19.0760, 73.0130),
    ("Palm Beach Road", r"palm beach( road)?", "sanpada", 19.0565, 73.0020),
    ("Seawoods Grand Central", r"(seawoods\s+)?grand central", "seawoods", 19.0223, 73.0191),
    ("Kharghar Central Park", r"(kharghar\s+)?central park", "kharghar", 19.0510, 73.0640),
    ("Utsav Chowk", r"(kharghar\s+)?utsav( chowk)?", "kharghar", 19.0460, 73.0760),
    ("Belapur CBD", r"\bcbd( belapur)?|belapur junction", "belapur", 19.0170, 73.0380),
    ("Airoli Bridge", r"airoli (creek )?bridge|ऐरोली ब्रिज", "airoli", 19.1625, 73.0000),
    ("Thane-Belapur Road", r"thane[\s-]+belapur( road)?", "ghansoli", 19.1100, 73.0050),
    ("Sion-Panvel Highway", r"sion[\s-]+panvel( highway| road)?", "sanpada", 19.0590, 73.0150),
]

# "<zone> station" is handled generically in the NER step
STATION_RE = r"(?:railway\s+)?(?:station|स्टेशन|स्थानक)"

ROAD_BEARINGS = [15, 80, 140]  # degrees; three road corridors through every zone


def haversine_m(lat1, lng1, lat2, lng2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def offset(lat, lng, bearing_deg, dist_m):
    """Move a point by dist_m along a bearing (small-distance approximation)."""
    b = math.radians(bearing_deg)
    dlat = (dist_m * math.cos(b)) / 111320.0
    dlng = (dist_m * math.sin(b)) / (111320.0 * math.cos(math.radians(lat)))
    return lat + dlat, lng + dlng


def nearest_zone(lat, lng):
    return min(ZONES, key=lambda z: haversine_m(lat, lng, z["lat"], z["lng"]))


def generate_lamps(seed=11):
    """Deterministic synthetic lamp network: three road corridors through every zone, plus a short lit road
    through every landmark and railway station so complaints that name a landmark always find a lamp nearby."""
    rnd = random.Random(seed)
    lamps, counters = [], {}

    def road(zone, lat0, lng0, bearing, n, back=360):
        jitter = rnd.uniform(-8, 8)
        start = offset(lat0, lng0, bearing + 180, back)
        start = offset(start[0], start[1], bearing + 90, rnd.uniform(-60, 60))
        side = 1
        for i in range(n):
            lat, lng = offset(start[0], start[1], bearing + jitter, i * 58)
            lat, lng = offset(lat, lng, bearing + 90, 9 * side)
            side = -side
            counters[zone["id"]] = counters.get(zone["id"], 0) + 1
            age = 1 + int(rnd.random() * 11)
            lamps.append(dict(
                id=f"SL-{zone['code']}-{counters[zone['id']]:03d}",
                lat=round(lat, 6), lng=round(lng, 6), zone=zone["id"], age=age,
                volt_var=round(min(1.0, max(0.0, rnd.gauss(0.35 * zone["w"], 0.18))), 3),
                driver=rnd.choices([0, 1, 2], weights=[3, 3, 4])[0],  # 0 ballast, 1 electronic, 2 LED
                burn_hours=int(3800 + rnd.random() * 900),
                pole_cond=round(min(1.0, max(0.0, rnd.gauss(0.3 + age * 0.04, 0.15))), 3),
                wattage=rnd.choice([36, 70, 90, 120]),
            ))

    for z in ZONES:
        for bearing in ROAD_BEARINGS:
            road(z, z["lat"], z["lng"], bearing, 13 + rnd.randint(0, 3))
    for z in ZONES:
        road(z, z["station"][0], z["station"][1], rnd.choice([30, 100, 160]), 8, back=230)
    for i, (name, _re, zid, lat, lng) in enumerate(LANDMARKS):
        road(ZM[zid], lat, lng, (i * 67) % 180, 8, back=230)
    return lamps
