from backend import nlp


def u(text, channel="Web portal", gps=None):
    return nlp.understand(text, channel, gps)


def test_classifier_metrics_are_reasonable():
    m = nlp.get_metrics()
    assert m["accuracy"] > 0.80
    assert m["accuracy"] > m["baseline_accuracy"] + 0.2  # ML clearly beats the old keyword rules
    assert len(m["per_class"]) == 8


def test_classifies_each_language():
    assert u("The street light near Vashi Station is flickering on and off")["cls"] == "flicker"
    assert u("Kharghar Central Park ke paas light band hai, andhera hai")["lang"] == "Hinglish"
    assert u("नेरुल स्टेशन के पास स्ट्रीट लाइट बंद है")["lang"] == "Hindi"
    assert u("वाशी स्टेशन जवळ दिवा बंद आहे, खूप अंधार आहे")["lang"] == "Marathi"


def test_electrical_danger_is_never_routine():
    r = u("Sparks coming out of the pole near Vashi Station")
    assert r["cls"] == "hazard" and r["sev"]["label"] in ("High", "Critical")


def test_ner_and_geocoding():
    r = u("SL-NER-021 not glowing near D Y Patil Stadium since 3 days")
    labels = {e["label"] for e in r["ents"]}
    assert {"POLE_ID", "LANDMARK", "DURATION", "FAULT"} <= labels
    assert r["pole_ids"] == ["SL-NER-021"]
    assert r["geo"]["zone"] == "nerul"
    assert abs(r["dur_days"] - 3) < 1e-6


def test_no_location_means_no_geo():
    assert u("Street light not working near the temple, please fix")["geo"] is None


def test_gps_pin_overrides_text():
    r = u("light off", gps=(19.0330, 73.0190))
    assert r["geo"]["conf"] >= 0.99 and r["geo"]["zone"] == "nerul"


def test_channel_cleanup():
    email = u("Subject: Lamp dead near Belapur Station\nHello\nLamp off for 5 days.\n> quoted old mail\n-- \nRegards Bob", "Email")
    assert "quoted" not in email["text"] and "Bob" not in email["text"] and email["prep"]
    tweet = u("@NMMC_Helpline #NerulStreetlight flickering! \U0001F621 pls fix", "X / Twitter")
    assert "@" not in tweet["text"] and "#" not in tweet["text"] and "please" in tweet["text"]


def test_severity_is_explained_and_adds_up():
    r = u("Street light not working near the school at night, children walk here, very unsafe, since 5 days")
    why = r["sev"]["why"]
    assert why[0].startswith("Base level")
    total = int(why[0].split(":")[-1]) + sum(int(w.split(":")[-1].replace("+", "")) for w in why[1:])
    assert r["sev"]["score"] == min(100, total)
