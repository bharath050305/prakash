"""Technician scheduling: priority- and skill-aware route optimisation versus a first-come-first-served baseline.

Objective for one route = travel km + lambda * sum(priority weight x completion time in hours).
Jobs are placed by cheapest insertion (in priority order), then improved by 2-opt / or-opt within each route.
Capacity is each technician's shift length in minutes (travel + on-site repair).
"""
import math

from . import geo
from .nlp import CLASS_META

SPEED_KMH = 24.0
LAMBDA = 2.2


def priority(t, now_ms):
    """Higher = more urgent. Severity + ageing + SLA pressure + citizen confirmations."""
    age_h = max(0.0, (now_ms - t["ts"]) / 3.6e6)
    sla_left_h = ((t["due_ts"] or now_ms) - now_ms) / 3.6e6
    pressure = 0 if sla_left_h > 12 else min(25, (12 - sla_left_h) * 2.2)
    return t["sev"] + min(25, age_h * 0.6) + pressure + min(15, 3 * (t["reports"] - 1))


def eligible(tech, job):
    return set(CLASS_META[job["cls"]]["needs"]) <= set(tech["skills"])


def _km(a, b):
    return geo.haversine_m(a["lat"], a["lng"], b["lat"], b["lng"]) / 1000.0


def simulate(route, tech, start_ms):
    """Timeline of one route -> (km, elapsed minutes, list of (eta_ms, finish_ms))."""
    cur, clock, km, times = {"lat": tech["depot_lat"], "lng": tech["depot_lng"]}, 0.0, 0.0, []
    for j in route:
        d = _km(cur, j)
        km += d
        clock += d / SPEED_KMH * 60
        eta = start_ms + clock * 60000
        clock += CLASS_META[j["cls"]]["mins"]
        times.append((eta, start_ms + clock * 60000))
        cur = j
    if route:
        d = _km(cur, {"lat": tech["depot_lat"], "lng": tech["depot_lng"]})
        km += d
        clock += d / SPEED_KMH * 60
    return km, clock, times


def _cost(route, tech, start_ms, prio):
    km, clock, times = simulate(route, tech, start_ms)
    return km + LAMBDA * sum((prio[j["id"]] / 100.0) * ((t[0] - start_ms) / 3.6e6) for j, t in zip(route, times)), clock


def _improve(route, tech, start_ms, prio):
    best, bc = route[:], _cost(route, tech, start_ms, prio)[0]
    improved = True
    while improved and len(best) > 2:
        improved = False
        for i in range(len(best) - 1):
            for k in range(i + 1, len(best)):
                cand = best[:i] + best[i:k + 1][::-1] + best[k + 1:]
                c = _cost(cand, tech, start_ms, prio)[0]
                if c < bc - 1e-9:
                    best, bc, improved = cand, c, True
        for i in range(len(best)):
            job = best[i]
            rest = best[:i] + best[i + 1:]
            for k in range(len(rest) + 1):
                cand = rest[:k] + [job] + rest[k:]
                c = _cost(cand, tech, start_ms, prio)[0]
                if c < bc - 1e-9:
                    best, bc, improved = cand, c, True
    return best


def build_plan(jobs, techs, now_ms, mode="opt"):
    """jobs: dicts with id, lat, lng, cls, sev, sev_label, ts, due_ts, reports. techs: dicts with skills, depot_*, capacity_min."""
    techs = [dict(t, route=[]) for t in techs if t["on_shift"]]
    prio = {j["id"]: priority(j, now_ms) for j in jobs}
    deferred = []
    if not techs:
        return _summarise([], jobs, now_ms, deferred=list(jobs), mode=mode)
    if mode == "manual":
        # what a busy human dispatcher does: oldest complaint first, nearest depot, visit in arrival order, skills not checked
        for j in sorted(jobs, key=lambda x: x["ts"]):
            for t in sorted(techs, key=lambda t: _km(j, {"lat": t["depot_lat"], "lng": t["depot_lng"]})):
                _, clock, _ = simulate(t["route"] + [j], t, now_ms)
                if clock <= t["capacity_min"]:
                    t["route"].append(j)
                    break
            else:
                deferred.append(j)
    else:
        for j in sorted(jobs, key=lambda x: -prio[x["id"]]):
            best, bc = None, math.inf
            for t in techs:
                if not eligible(t, j):
                    continue
                base, _ = _cost(t["route"], t, now_ms, prio)
                for pos in range(len(t["route"]) + 1):
                    cand = t["route"][:pos] + [j] + t["route"][pos:]
                    c, clock = _cost(cand, t, now_ms, prio)
                    if clock > t["capacity_min"]:
                        continue
                    if c - base < bc:
                        bc, best = c - base, (t, cand)
            if best:
                best[0]["route"] = best[1]
            else:
                deferred.append(j)
        for t in techs:
            t["route"] = _improve(t["route"], t, now_ms, prio)
    return _summarise(techs, jobs, now_ms, deferred, mode)


def _summarise(techs, jobs, now_ms, deferred, mode):
    total_km, hi_done, hi_n, late, mismatch, planned = 0.0, 0.0, 0, 0, 0, 0
    out = []
    for t in techs:
        km, clock, times = simulate(t["route"], t, now_ms)
        total_km += km
        stops = []
        for seq, (j, (eta, fin)) in enumerate(zip(t["route"], times), 1):
            planned += 1
            if j["sev_label"] in ("Critical", "High"):
                hi_done += (eta - now_ms) / 60000
                hi_n += 1
            if j["due_ts"] and fin > j["due_ts"]:
                late += 1
            if not eligible(t, j):
                mismatch += 1
            stops.append(dict(ticket_id=j["id"], seq=seq, eta_ts=int(eta), finish_ts=int(fin), lat=j["lat"], lng=j["lng"],
                              cls=j["cls"], sev=j["sev"], sev_label=j["sev_label"], zone=j.get("zone"),
                              ok=eligible(t, j)))
        out.append(dict(tech_id=t["id"], name=t["name"], color=t["color"], skills=t["skills"], depot=dict(lat=t["depot_lat"], lng=t["depot_lng"], zone=t["depot_zone"]),
                        km=round(km, 1), minutes=round(clock), utilisation=round(min(1, clock / t["capacity_min"]), 2), stops=stops))
    # jobs left unplanned count as SLA risk if their due time is before the end of the day
    for j in deferred:
        if j["due_ts"] and j["due_ts"] < now_ms + 8 * 3.6e6:
            late += 1
    return dict(mode=mode, techs=out, deferred=[dict(ticket_id=j["id"], cls=j["cls"], sev_label=j["sev_label"]) for j in deferred],
                metrics=dict(km=round(total_km, 1), planned=planned, deferred=len(deferred), sla_breaches=late, skill_mismatch=mismatch,
                             avg_high_wait_min=round(hi_done / hi_n) if hi_n else None))
