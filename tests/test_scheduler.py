import random

from backend import scheduler

NOW = 1_750_000_000_000


def job(i, lat, lng, cls="outage", sev=40, label="Medium", age_h=1, reports=1):
    return dict(id=i, lat=lat, lng=lng, cls=cls, sev=sev, sev_label=label, ts=NOW - age_h * 3600000,
                due_ts=NOW + 40 * 3600000, reports=reports, zone="x")


def tech(i, lat, lng, skills=(), cap=480):
    return dict(id=i, name=f"T{i}", skills=list(skills), color="#fff", depot_zone="z", depot_lat=lat, depot_lng=lng,
                on_shift=1, capacity_min=cap)


def test_hazard_goes_only_to_hv_crew():
    jobs = [job(1, 19.05, 73.01, cls="hazard", sev=80, label="Critical")]
    techs = [tech(1, 19.05, 73.01), tech(2, 19.10, 73.05, skills=["hv"])]  # the nearer crew is not certified
    plan = scheduler.build_plan(jobs, techs, NOW)
    assigned = {t["tech_id"]: len(t["stops"]) for t in plan["techs"]}
    assert assigned[2] == 1 and assigned[1] == 0
    assert plan["metrics"]["skill_mismatch"] == 0


def test_cluster_needs_hv_and_bucket():
    jobs = [job(1, 19.05, 73.01, cls="cluster", sev=60, label="High")]
    techs = [tech(1, 19.05, 73.01, skills=["hv"]), tech(2, 19.2, 73.1, skills=["hv", "bucket"])]
    plan = scheduler.build_plan(jobs, techs, NOW)
    assert [t["tech_id"] for t in plan["techs"] if t["stops"]] == [2]


def test_capacity_defers_low_priority_work():
    jobs = [job(i, 19.05 + i * 0.001, 73.01, sev=90 - i, label="High") for i in range(20)]
    plan = scheduler.build_plan(jobs, [tech(1, 19.05, 73.01, cap=120)], NOW)
    assert plan["metrics"]["deferred"] > 0
    planned = [s["ticket_id"] for s in plan["techs"][0]["stops"]]
    assert 0 in planned  # the most severe job is never the one deferred


def test_optimised_beats_manual_distance():
    r = random.Random(3)
    jobs = [job(i, 19.0 + r.random() * .12, 73.0 + r.random() * .08, sev=r.randint(20, 70), label="Medium", age_h=r.random() * 40)
            for i in range(24)]
    techs = [tech(1, 19.02, 73.02), tech(2, 19.08, 73.0), tech(3, 19.05, 73.07)]
    opt = scheduler.build_plan(jobs, techs, NOW, "opt")["metrics"]
    man = scheduler.build_plan(jobs, techs, NOW, "manual")["metrics"]
    assert opt["km"] < man["km"]
    assert opt["planned"] == man["planned"] == 24


def test_off_shift_crews_are_ignored():
    t = tech(1, 19.05, 73.01)
    t["on_shift"] = 0
    plan = scheduler.build_plan([job(1, 19.05, 73.01)], [t], NOW)
    assert plan["metrics"]["planned"] == 0 and plan["metrics"]["deferred"] == 1
