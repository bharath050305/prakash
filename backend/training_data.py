"""Synthetic labelled complaints used to train and evaluate the fault classifier.

No public labelled streetlight-complaint corpus exists, so complaints are composed from phrase
banks in English, Hinglish, Hindi and Marathi. The TEST banks contain paraphrases that never
appear in the TRAIN banks, so the reported accuracy measures generalisation to new wording
rather than memorisation. EVAL_HANDWRITTEN is a small set of realistic messages written by hand.
"""
import random

CLASSES = ["outage", "flicker", "dayburn", "hazard", "dim", "vandal", "timer", "cluster"]

# ------------------------------------------------------------------ phrase banks
TRAIN = {
    "en": {
        "outage": ["the lamp has gone dark", "streetlamp is out of service, area in darkness", "bulb is fused and the light is off", "light is dead since the rain", "street light is not working", "the streetlight has stopped working", "lamp post is completely dead",
                   "no light on the street, the lamp is off", "light pole is not glowing at all",
                   "streetlight went off and has not come back", "the lamp is switched off, complete darkness",
                   "the light is out, it is pitch dark here", "street lamp not lit", "light not working, very dark at night"],
        "flicker": ["lamp is unsteady and keeps pulsating", "the light wobbles between on and off", "light switches on off again and again", "streetlight is unstable and shivering", "street light keeps flickering on and off", "the lamp is blinking continuously",
                    "streetlight flashes intermittently", "light is flickering like a strobe",
                    "lamp keeps turning on and off every few seconds", "the light flickers all night",
                    "intermittent light, it blinks repeatedly", "streetlight is fluctuating, on off on off"],
        "dayburn": ["lights are still glowing at noon", "lamp lit in the afternoon, power is wasted", "street lights are burning during the day", "lamp is on in daytime, wasting electricity",
                    "streetlight stays lit all day long", "lights not switching off even in the morning",
                    "the light is glowing in full daylight", "lamp is always on, burning 24 hours",
                    "streetlights on since morning, power wasted", "light has not turned off after sunrise"],
        "hazard": ["loose cable hanging dangerously near the pole", "bare wires open at the lamp base, risk of electrocution", "pole is hot and giving out smoke", "pole bent badly and unstable", "wire is hanging from the street light pole", "sparks coming out of the lamp post",
                   "exposed live wires on the light pole", "pole is leaning and may fall",
                   "streetlight pole got tilted after the rain, very dangerous", "short circuit in the pole, smoke coming out",
                   "electric shock risk, cable open at the base of the pole", "the pole is rusted and bent, might collapse",
                   "burning smell and sparks from the junction box", "someone got a shock from the light pole"],
        "dim": ["lamp output is low, the road is gloomy", "light is weaker than before, not bright enough for the road", "the light has become dull and poor", "the street light is very dim", "light is too weak, barely visible",
                "lamp gives very low light, yellowish and faint", "poor illumination, the light is dull",
                "streetlight brightness has reduced a lot", "light is faint and does not light up the road",
                "insufficient lighting, lamp is dim"],
        "vandal": ["someone damaged the lamp and took the fittings", "light head missing, only wires left", "fixture was broken by miscreants", "glass of the street light is broken", "lamp cover is missing and bulb is hanging",
                   "streetlight cable was stolen", "someone smashed the light fixture",
                   "light fitting stolen from the pole", "the lamp has been vandalised, fixture is damaged",
                   "theft of wires from the lamp post", "broken lamp head lying on the road"],
        "timer": ["lights come on too late because of the schedule fault", "sensor is faulty, lights do not switch on at sunset", "streetlights are not switching on automatically in the evening", "timer problem, lights turn on very late",
                  "the controller panel is faulty, lights not on at schedule",
                  "photocell sensor seems to be damaged, lights do not turn on at dusk",
                  "lights switch off at midnight because of timer fault", "feeder panel issue, lights come on at wrong time",
                  "automatic switch not working, lights on at odd hours", "the contactor in the control box is faulty"],
        "cluster": ["every light along this road is off", "whole row of poles without light", "many lamps dark in one line", "the entire street has no lights", "all the street lights on this road are off",
                    "multiple lights are not working in the whole stretch", "a row of lamps is dark, about 8 lights are out",
                    "several streetlights are off together", "complete road is dark, none of the poles are lit",
                    "whole lane lights are off since the power trip", "many streetlights not working on this road"],
    },
    "hinglish": {
        "outage": ["streetlight band hai", "light nahi jal rahi, andhera hai", "batti band pad gayi hai",
                   "street light kharab hai, raat me andhera rehta hai"],
        "flicker": ["light jhilmil kar rahi hai", "batti baar baar on off ho rahi hai", "light blink kar rahi hai"],
        "dayburn": ["din mein bhi light jal rahi hai", "street light subah se on hai band nahi ho rahi",
                    "din me batti chalu rehti hai, bijli barbaad"],
        "hazard": ["pole se wire latak raha hai, spark ho raha hai", "khamba jhuk gaya hai, girne wala hai",
                   "light pole me current aa raha hai, khatarnak hai"],
        "dim": ["light bahut kam roshni de rahi hai", "street light dim hai, roshni kam hai", "batti ki roshni bahut halki hai"],
        "vandal": ["light ka glass toot gaya hai", "kisi ne street light ka wire chura liya", "lamp ka cover gayab hai"],
        "timer": ["timer kharab hai, light shaam ko on nahi hoti", "light apne aap on nahi ho rahi, panel me problem hai",
                  "sensor kharab lagta hai, light time pe on nahi hoti"],
        "cluster": ["poori road ki lights band hai", "sabhi street lights band hai is gali me",
                    "kai lights ek saath band hai, pura stretch andhera"],
    },
    "hi": {
        "outage": ["स्ट्रीट लाइट बंद है", "बत्ती नहीं जल रही, अंधेरा है", "लाइट खराब है और रात में अंधेरा रहता है"],
        "flicker": ["लाइट बार बार जल बुझ रही है", "बत्ती टिमटिमा रही है"],
        "dayburn": ["दिन में भी स्ट्रीट लाइट जल रही है", "सुबह से बत्ती चालू है, बंद नहीं हो रही"],
        "hazard": ["खंभे से तार लटक रहा है और चिंगारी निकल रही है", "पोल झुक गया है, गिरने का खतरा है", "खंभे में करंट आ रहा है"],
        "dim": ["लाइट की रोशनी बहुत कम है", "बत्ती बहुत धीमी जल रही है"],
        "vandal": ["लाइट का शीशा टूट गया है", "किसी ने बत्ती का तार चुरा लिया"],
        "timer": ["टाइमर खराब है, शाम को लाइट चालू नहीं होती", "लाइट अपने आप चालू नहीं हो रही, पैनल में दिक्कत है"],
        "cluster": ["पूरी सड़क की लाइटें बंद हैं", "सभी स्ट्रीट लाइट बंद हैं इस गली में"],
    },
    "mr": {
        "outage": ["स्ट्रीट लाईट बंद आहे", "दिवा लागत नाही, अंधार आहे"],
        "flicker": ["लाईट सारखी लुकलुकत आहे", "दिवा वारंवार चालू बंद होतोय"],
        "dayburn": ["दिवसा पण स्ट्रीट लाईट चालू आहे", "सकाळपासून दिवे चालू आहेत, बंद होत नाहीत"],
        "hazard": ["खांबावरून तार लोंबकळत आहे, ठिणग्या पडत आहेत", "खांब वाकला आहे, पडण्याचा धोका आहे"],
        "dim": ["लाईटचा प्रकाश खूप कमी आहे", "दिवा अंधुक जळतोय"],
        "vandal": ["लाईटची काच फुटली आहे", "कोणीतरी दिव्याची वायर चोरली"],
        "timer": ["टायमर बिघडला आहे, संध्याकाळी लाईट लागत नाही", "लाईट आपोआप चालू होत नाही, पॅनेलमध्ये बिघाड आहे"],
        "cluster": ["संपूर्ण रस्त्यावरचे दिवे बंद आहेत", "या गल्लीतील सर्व लाईट बंद आहेत"],
    },
}

TEST = {
    "en": {
        "outage": ["lamp near our gate has died", "street lamp is out of order and the area is dark",
                   "the pole light is off since yesterday night", "no illumination from the street light now",
                   "light went out and was never repaired", "streetlamp dead, need replacement"],
        "flicker": ["light keeps blinking irregularly", "street lamp is unstable, goes on and off",
                    "the lamp is twinkling annoyingly all evening", "light flickers again and again", "lamp is stuttering"],
        "dayburn": ["light is on in the afternoon sun", "streetlamp glowing at noon, electricity wasted",
                    "lamps never go off in the day", "lights still lit at 10 am", "burning even at midday"],
        "hazard": ["a cable is dangling dangerously from the lamp post", "pole has tilted and is about to fall",
                   "sparking noticed near the light pole after rain", "naked wires near the lamp base, risk of electrocution",
                   "light pole is hot and smoking", "pole bent after a truck hit it"],
        "dim": ["light output is low and dull", "streetlamp looks weak and gloomy", "lamp is not bright enough",
                "illumination has become poor", "dimmer than before"],
        "vandal": ["light glass shattered by miscreants", "someone stole the lamp from the pole",
                   "fixture has been damaged by vandals", "lamp head is missing", "cover broken and cables cut"],
        "timer": ["lights switch on at the wrong time", "the automatic timer has failed",
                  "sensor fault, lights don't come on at sunset", "control panel malfunction on this road",
                  "schedule is off, lights go on late"],
        "cluster": ["all lights in this lane are off", "the whole row of poles is dark",
                    "many lamps are out on the same road", "no streetlight working along the entire stretch",
                    "about 10 lights out in a line"],
    },
    "hinglish": {
        "outage": ["light chalti nahi hai yahan", "lamp nahi jalta, andhera hi andhera", "street light bilkul dead hai"],
        "flicker": ["batti tim tim kar rahi hai", "light chalu band chalu band ho rahi"],
        "dayburn": ["dopahar mein bhi batti jal rahi hai", "din ke time light on rehti hai"],
        "hazard": ["wire khula hua hai, shock lag sakta hai", "pole girne wala hai, bahut danger"],
        "dim": ["roshni bahut kam hai light ki", "light halki si jal rahi hai"],
        "vandal": ["kisi ne lamp tod diya", "light ka saaman chori ho gaya"],
        "timer": ["light samay par on nahi hoti, timer problem", "control box kharab lagta hai"],
        "cluster": ["saari lights off hain is road par", "pura rasta andhere mein hai, kai poles band"],
    },
    "hi": {
        "outage": ["सड़क की बत्ती गुल है", "लाइट जलती नहीं है यहाँ"],
        "flicker": ["बत्ती रुक रुक कर जल रही है"],
        "dayburn": ["दोपहर में भी लाइट जल रही है"],
        "hazard": ["बिजली का तार खुला लटका है", "खंभा गिरने वाला है"],
        "dim": ["रोशनी बहुत मद्धम है"],
        "vandal": ["किसी ने लैंप तोड़ दिया", "बत्ती का सामान चोरी हो गया"],
        "timer": ["समय पर लाइट चालू नहीं होती, टाइमर की समस्या"],
        "cluster": ["इस रोड की सारी बत्तियां बंद हैं", "कई लाइटें एक साथ बंद हैं"],
    },
    "mr": {
        "outage": ["रस्त्यावरचा दिवा बंद पडला आहे"],
        "flicker": ["दिवा सारखा लुकलुकतो आहे"],
        "dayburn": ["दुपारी सुद्धा दिवा जळत आहे"],
        "hazard": ["उघडी वायर लटकत आहे, शॉक लागू शकतो"],
        "dim": ["प्रकाश खूपच अंधुक आहे"],
        "vandal": ["कोणीतरी दिवा फोडला"],
        "timer": ["वेळेवर लाईट लागत नाही, टायमरची समस्या"],
        "cluster": ["सर्व दिवे एकदम बंद आहेत या रस्त्यावर"],
    },
}

# ------------------------------------------------------------------ locations, closers, durations
PLACES_EN = ["SIES College Nerul", "Vashi Station", "Inorbit Mall Vashi", "Palm Beach Road", "Kharghar Central Park",
             "DY Patil Stadium", "Airoli Bridge", "Seawoods Grand Central", "Belapur Station", "Ghansoli Station",
             "Sanpada Station", "Utsav Chowk Kharghar", "APMC Market Vashi", "Nerul Station", "Sector 17 Vashi",
             "Sector 12 Kharghar", "Sector 5 Airoli", "Sector 44 Seawoods", "the temple", "the school gate",
             "the bus stop", "my building", "the petrol pump", "the hospital"]
PREP_EN = ["near {p}", "at {p}", "opposite {p}", "outside {p}", "in front of {p}", "behind {p}", "next to {p}", "{p}"]
PLACES_HI = ["नेरुल स्टेशन", "वाशी स्टेशन", "खारघर सेंट्रल पार्क", "बेलापुर स्टेशन", "ऐरोली ब्रिज", "सानपाडा स्टेशन",
             "सीवुड्स", "घनसोली स्टेशन", "खारघर", "वाशी"]
PLACES_MR = ["नेरूळ स्टेशन", "वाशी स्टेशन", "बेलापूर स्टेशन", "सीवूड्स", "खारघर", "सानपाडा स्टेशन", "ऐरोली ब्रिज"]
OPENERS_EN = ["", "", "", "Hello, ", "Complaint: ", "Please note, ", "Sir, ", "Urgent - ", "Hi team, "]
CLOSERS_EN = ["", "", "", " Please fix it soon.", " Kindly look into this.", " Urgent!", " Students walk here at night.",
              " Women feel unsafe at night.", " This is a busy road.", " Thanks.", " Please send someone.", " plz help"]
CLOSERS_HINGLISH = ["", "", " Please fix karo", " Jaldi dekhiye", " Bahut problem hai", " Kripya theek karein"]
CLOSERS_HI = ["", "", " कृपया जल्दी ठीक करें", " बहुत परेशानी है"]
CLOSERS_MR = ["", "", " कृपया लवकर दुरुस्त करा", " खूप त्रास होतोय"]
DUR_EN = ["", "", "", " since {n} days", " for {n} days", " since yesterday", " for two weeks", " since last night", " for a week"]
DUR_HINGLISH = ["", "", " {n} din se", " kal raat se"]
DUR_HI = ["", "", " {n} दिन से", " कल रात से"]
DUR_MR = ["", "", " {n} दिवसांपासून", " काल रात्रीपासून"]


def _typo(rnd, s):
    if len(s) < 8 or rnd.random() > 0.22:
        return s
    i = rnd.randrange(1, len(s) - 2)
    kind = rnd.random()
    if kind < .4:
        return s[:i] + s[i + 1:]            # drop a char
    if kind < .7:
        return s[:i] + s[i + 1] + s[i] + s[i + 2:]  # swap
    return s[:i] + s[i] + s[i:]             # double a char


def compose(rnd, banks, cls, lang=None, with_noise=True):
    lang = lang or rnd.choices(["en", "hinglish", "hi", "mr"], weights=[60, 20, 10, 10])[0]
    phrase = rnd.choice(banks[lang][cls])
    n = rnd.randint(2, 9)
    if lang == "en":
        place = rnd.choice(PREP_EN).format(p=rnd.choice(PLACES_EN))
        order = rnd.random()
        body = f"{phrase} {place}" if order < .7 else f"{place.capitalize()} {phrase}"
        body += rnd.choice(DUR_EN).format(n=n)
        text = rnd.choice(OPENERS_EN) + body + "." + rnd.choice(CLOSERS_EN)
        if rnd.random() < .25:
            text = text.lower()
    elif lang == "hinglish":
        place = rnd.choice(PLACES_EN)
        text = f"{place} ke paas {phrase}{rnd.choice(DUR_HINGLISH).format(n=n)}.{rnd.choice(CLOSERS_HINGLISH)}"
    elif lang == "hi":
        place = rnd.choice(PLACES_HI)
        text = f"{place} के पास {phrase}{rnd.choice(DUR_HI).format(n=n)}।{rnd.choice(CLOSERS_HI)}"
    else:
        place = rnd.choice(PLACES_MR)
        text = f"{place} जवळ {phrase}{rnd.choice(DUR_MR).format(n=n)}.{rnd.choice(CLOSERS_MR)}"
    if with_noise:
        text = _typo(rnd, text)
    return text.strip()


def build_dataset(banks, per_class, seed):
    rnd = random.Random(seed)
    X, y = [], []
    for cls in CLASSES:
        for _ in range(per_class):
            X.append(compose(rnd, banks, cls))
            y.append(cls)
    return X, y


def train_set():
    return build_dataset(TRAIN, 170, seed=1)


def test_set():
    return build_dataset(TEST, 60, seed=2)


def random_complaint(rnd, cls=None):
    """One realistic complaint (TRAIN wording) for the live-intake simulator."""
    cls = cls or rnd.choices(CLASSES, weights=[30, 18, 8, 10, 10, 8, 8, 8])[0]
    lang = rnd.choices(["en", "hinglish", "hi", "mr"], weights=[68, 18, 7, 7])[0]
    return cls, compose(rnd, TRAIN, cls, lang=lang, with_noise=False)


# hand-written realistic messages with their true label (not generated from the banks)
EVAL_HANDWRITTEN = [
    ("The light near SIES College Nerul keeps flickering on and off since 3 days. Students walk here at night, very unsafe.", "flicker"),
    ("Caller reports sparks and a wire hanging from the pole near Vashi Station!", "hazard"),
    ("Kharghar Central Park ke paas 4 lights band hai, andhera hai. Please fix", "cluster"),
    ("नेरुल स्टेशन के पास स्ट्रीट लाइट बंद है, अंधेरा है", "outage"),
    ("SL-NER-021 not glowing near D Y Patil Stadium", "outage"),
    ("Streetlights in Sector 17 Kharghar are burning in the daytime.", "dayburn"),
    ("Entire lane behind Inorbit Mall Vashi is dark for a week. Multiple lamps not working.", "cluster"),
    ("Street light pole near Airoli Bridge is leaning after the rain. Pole no. 214.", "hazard"),
    ("Cable stolen from lamp post near Seawoods Grand Central. Light is not working.", "vandal"),
    ("Lights near Belapur Station are very dim, hardly visible at night.", "dim"),
    ("Timer issue: streetlights near Ghansoli Station not switching on in the evening.", "timer"),
    ("the lamp opposite my house is blinking again and again since yesterday", "flicker"),
    ("Someone broke the glass of the streetlight at Sanpada and the bulb is hanging out", "vandal"),
    ("Why are all the lights off on Palm Beach Road? Whole stretch is dark.", "cluster"),
    ("Street light glowing at 11 in the morning, what a waste of electricity", "dayburn"),
    ("there is a live wire open near the pole at Nerul station, please send electrician immediately", "hazard"),
    ("Light is very weak near the bus stop at Vashi, can't see anything", "dim"),
    ("our street lights come on at 9 pm instead of 7, probably the sensor is broken", "timer"),
    ("lamp post light not on since last night", "outage"),
    ("Streetlight fixture stolen from the pole near APMC market", "vandal"),
    ("batti jhilmil kar rahi hai Seawoods mein", "flicker"),
    ("दिवसा पण स्ट्रीट लाईट चालू आहे वाशी मध्ये", "dayburn"),
    ("पोल झुक गया है खारघर में, गिरने वाला है", "hazard"),
    ("The street lamp has gone dark after the rain", "outage"),
]
