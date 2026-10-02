"""Records a narrated walkthrough of Prakash.

Needs: the server running on http://127.0.0.1:5000 with fresh demo data, `pip install playwright`,
Microsoft Edge, ffmpeg on PATH, and Windows (voices come from the built-in speech engine).

    python demo_video/make_demo_video.py

Output: demo_video/Prakash_Demo.mp4
"""
import asyncio
import os
import re
import subprocess
import sys
import time
import wave

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "_work")
OUT = os.path.join(HERE, "Prakash_Demo.mp4")
BASE = "http://127.0.0.1:5000"
W, H = 1366, 768
VOICE = "Microsoft Hazel Desktop"
START_LAG = 0.35  # video clock starts slightly before our scene clock

OVERLAY_JS = r"""
window.addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;z-index:99999;width:24px;height:24px;border-radius:50%;background:rgba(245,160,11,.4);border:2px solid #F5A00B;pointer-events:none;transform:translate(-50%,-50%);left:-60px;top:-60px;transition:background .1s,transform .1s';
  document.body.appendChild(c);
  document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  document.addEventListener('mousedown', () => { c.style.background = 'rgba(245,160,11,.95)'; c.style.transform = 'translate(-50%,-50%) scale(.8)'; }, true);
  document.addEventListener('mouseup', () => { c.style.background = 'rgba(245,160,11,.4)'; c.style.transform = 'translate(-50%,-50%)'; }, true);
  const cap = document.createElement('div');
  cap.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:74%;z-index:99998;background:rgba(10,19,38,.9);color:#fff;font:500 20px/1.4 "IBM Plex Sans","Segoe UI",sans-serif;padding:10px 22px;border-radius:14px;text-align:center;display:none;box-shadow:0 10px 34px rgba(0,0,0,.45)';
  document.body.appendChild(cap);
  window.__cap = t => { cap.textContent = t; cap.style.display = t ? 'block' : 'none'; };
  const card = document.createElement('div');
  card.style.cssText = 'position:fixed;inset:0;z-index:99997;background:linear-gradient(150deg,#060C1A,#10244D 60%,#1B3A73);color:#fff;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;font-family:"Bricolage Grotesque","Segoe UI",sans-serif';
  document.body.appendChild(card);
  window.__card = h => { card.innerHTML = h; card.style.display = h ? 'flex' : 'none'; };
});
"""

TITLE_CARD = """
<div style="width:74px;height:74px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFE199,#F5A00B);box-shadow:0 0 0 12px rgba(245,160,11,.16),0 0 60px rgba(245,160,11,.6);margin-bottom:30px"></div>
<div style="font-size:64px;font-weight:700;letter-spacing:-.02em">Prakash</div>
<div style="font-size:30px;margin-top:10px;color:#FFD27A">Smart Streetlight Maintenance and Decision Support System</div>
<div style="font-size:20px;margin-top:28px;color:#B9C7E4;font-family:'IBM Plex Sans','Segoe UI',sans-serif">NLP course project · Group 6 · SDG 11 Sustainable Cities and Communities</div>
<div style="font-size:19px;margin-top:10px;color:#9FB0D3;font-family:'IBM Plex Sans','Segoe UI',sans-serif">Gregory · Bharath Rathinasabapathy · Harshwardhan Ahire</div>
"""

END_CARD = """
<div style="font-size:46px;font-weight:700">Technology stack</div>
<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 50px;margin-top:30px;text-align:left;font:500 21px/1.4 'IBM Plex Sans','Segoe UI',sans-serif;color:#E8EDF7">
<div><b style="color:#FFD27A">Backend</b><br>Python · Flask · SQLite · server-sent events</div>
<div><b style="color:#FFD27A">NLP</b><br>TF-IDF · logistic regression · rule and gazetteer NER</div>
<div><b style="color:#FFD27A">Machine learning</b><br>scikit-learn · gradient boosting · DBSCAN · Holt forecast</div>
<div><b style="color:#FFD27A">Optimisation</b><br>insertion heuristic · 2-opt · or-opt</div>
<div><b style="color:#FFD27A">Frontend</b><br>JavaScript modules · Leaflet · Chart.js</div>
<div><b style="color:#FFD27A">Quality</b><br>role-based access · 24 automated tests</div></div>
<div style="font-size:26px;margin-top:40px;color:#FFD27A">Thank you. Questions welcome.</div>
"""

# (name, narration, action)  -- actions are defined below; narration drives the pacing
SCENES = []


def scene(name, text):
    def deco(fn):
        SCENES.append((name, text, fn))
        return fn
    return deco


# ------------------------------------------------------------------ helpers
async def glide(page, sel, dx=0, dy=0, steps=22):
    loc = page.locator(sel).first
    await loc.scroll_into_view_if_needed()
    b = await loc.bounding_box()
    await page.mouse.move(b["x"] + b["width"] / 2 + dx, b["y"] + b["height"] / 2 + dy, steps=steps)
    await asyncio.sleep(0.15)


async def click(page, sel, **kw):
    await glide(page, sel, **kw)
    await page.locator(sel).first.click()


async def nav(page, key):
    await click(page, f'#side a[data-k="{key}"]')
    await asyncio.sleep(1.6)


async def scroll_to(page, y, pause=0.9):
    await page.evaluate("y => window.scrollTo({top: y, behavior: 'smooth'})", y)
    await asyncio.sleep(pause)


async def scroll_el(page, sel, y, pause=0.9):
    await page.evaluate("([s, y]) => document.querySelector(s).scrollTo({top: y, behavior: 'smooth'})", [sel, y])
    await asyncio.sleep(pause)


async def login_as(page, idx):
    await click(page, f'.demo-grid button[data-i="{idx}"]')
    await page.wait_for_selector("#view", timeout=15000)
    await asyncio.sleep(2.5)


async def logout(page):
    await click(page, "#logout")
    await page.wait_for_selector(".demo-grid", timeout=10000)
    await asyncio.sleep(0.8)


# ------------------------------------------------------------------ scenes
@scene("intro", "Hello everyone. This is Prakash, our smart streetlight maintenance and decision support system, built for the NLP course by Group 6, for Sustainable Development Goal eleven. "
               "The problem is simple. Faulty streetlights reported by citizens are still handled by hand, which means slow repairs, poor scheduling, and safety risks at night. "
               "Prakash automates the whole journey, from the first complaint to the finished repair, using natural language processing, machine learning and maps.")
async def s_intro(page):
    await page.evaluate("__card(%r)" % TITLE_CARD)
    await asyncio.sleep(9)
    await page.evaluate("__card('')")
    await asyncio.sleep(1)


@scene("roles", "The system has three roles: citizen, technician and admin. The server checks the role on every request, so each person only sees what they need. Let us start as a citizen.")
async def s_roles(page):
    await glide(page, '.demo-grid button[data-i="0"]')
    await glide(page, '.demo-grid button[data-i="2"]')
    await login_as(page, 1)


@scene("home", "This is the citizen home screen. The citizen sees their active reports, each with a live progress tracker, and the current status of every streetlight in the city.")
async def s_home(page):
    await asyncio.sleep(2)
    await scroll_to(page, 400, 2.5)
    await scroll_to(page, 0, 1)


@scene("report", "To report a fault, the citizen just writes in their own words. Here is a dangerous one: sparks are coming from the pole near Vashi Station, and a wire is hanging. "
                 "While they type, the same NLP pipeline runs live on the right. It detects the language, classifies the fault as an electrical hazard, scores it critical, finds the landmark Vashi Station using named entity recognition, and matches the exact lamp on the map. "
                 "It understands Hindi, Marathi and Hinglish too. Watch what happens with a Hindi message.")
async def s_report(page):
    await nav(page, "report")
    await click(page, "#txt")
    await page.keyboard.type("Sparks coming from the pole near Vashi Station and a wire is hanging!", delay=38)
    await asyncio.sleep(3.2)
    await scroll_to(page, 0, 0.5)
    await glide(page, "#ai", dx=-60, dy=-40)
    await asyncio.sleep(4)
    await click(page, '.samples button[data-i="2"]')
    await asyncio.sleep(3.5)
    await click(page, '.samples button[data-i="4"]')
    await asyncio.sleep(2.5)


@scene("submit", "The citizen can drop a pin on the map, or add a photo. When they submit, they get an instant reference number and an automatic reply in their own language. "
                 "Behind the scenes the complaint is stored, merged with any duplicate report of the same lamp, and because this one is critical, an alert goes to the control room straight away.")
async def s_submit(page):
    await scroll_to(page, 300, 1)
    await glide(page, "#pm", dx=40, dy=10)
    await asyncio.sleep(1.5)
    await click(page, "#submit")
    await page.wait_for_selector("#left .card.accent", timeout=15000)
    await asyncio.sleep(1.5)
    await scroll_to(page, 0, 4)


@scene("tickets", "Under My reports, the citizen tracks every ticket with a full timeline: received, verified by the AI, crew assigned, repairing, and fixed. Once a repair is done, the citizen can rate it.")
async def s_tickets(page):
    await nav(page, "tickets")
    await asyncio.sleep(2)
    await click(page, ".ticket-card")
    await asyncio.sleep(3)
    await scroll_to(page, 500, 3)
    await scroll_to(page, 0, 0.5)


@scene("admin", "Now the control room. The admin dashboard shows live indicators: open tickets, critical faults, the share of lamps working, how many complaints the AI triaged on its own, average fix time, and citizen rating. "
                "The map shows every lamp, heat where faults concentrate, and hotspot clusters. Complaints stream in on the right.")
async def s_admin(page):
    await logout(page)
    await login_as(page, 0)
    await asyncio.sleep(2)
    await glide(page, ".kpis .kpi:nth-child(2)")
    await glide(page, ".kpis .kpi:nth-child(4)")
    await click(page, '#layerSeg button[data-k="heat"]')
    await asyncio.sleep(1.5)
    await click(page, '#layerSeg button[data-k="heat"]')
    await glide(page, "#feed .fi", dy=30)
    await asyncio.sleep(1)


@scene("live", "Let me switch on live intake. New complaints now arrive from every channel, are classified, located and prioritised, and appear on the dashboard without any refresh. "
               "When a critical fault arrives, the admin gets a red alert, and the system automatically dispatches the nearest qualified technician.")
async def s_live(page):
    await scroll_to(page, 0, 0.3)
    await click(page, "#liveBtn")
    await asyncio.sleep(4)
    await scroll_to(page, 450, 1.2)
    await click(page, "#burst")
    await asyncio.sleep(2)
    await scroll_to(page, 0, 0.5)
    await page.evaluate("""fetch('/api/intake/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caller:'+91 98200 11122',transcript:'Live wire hanging and sparks from the pole near Seawoods Grand Central, very dangerous for kids'})})""")
    await asyncio.sleep(5)
    await click(page, "#liveBtn")


@scene("drawer", "Opening any ticket shows exactly how the AI decided. The entities are highlighted, the class probabilities and the words that drove the decision are listed, and the severity score explains every single point. "
                 "The admin can assign a technician, correct the fault type, add a note, or resolve the ticket.")
async def s_drawer(page):
    await click(page, "#feed .fi")
    await page.wait_for_selector(".drawer .card", timeout=10000)
    await asyncio.sleep(3)
    await scroll_el(page, ".drawer", 420, 3)
    await scroll_el(page, ".drawer", 900, 3)
    await scroll_el(page, ".drawer", 0, 0.5)
    await click(page, ".drawer [data-close]")


@scene("review", "When the AI is not sure, for example when a message names no location, it does not guess. The ticket goes to the review queue. The admin confirms the fault type and picks the lamp, "
                 "and every correction is saved as a training example, so the model keeps learning from humans.")
async def s_review(page):
    await nav(page, "review")
    await asyncio.sleep(2.5)
    card = page.locator("#cards .card[id]").first
    if await card.count():
        await page.select_option("#cards .card[id] [data-k=zone]", "nerul")
        await asyncio.sleep(0.8)
        await page.locator("#cards .card[id] [data-k=lamp]").first.select_option(index=1)
        await asyncio.sleep(1.5)
        await click(page, "#cards .card[id] [data-a=ok]")
        await asyncio.sleep(2)


@scene("lab", "The NLP lab shows the pipeline step by step. Here is a Hinglish message. The system cleans the text, detects the language, classifies the fault, extracts entities, scores severity, geocodes the place and snaps it to a lamp, and checks for duplicates. "
              "Emails and tweets are cleaned first, removing quoted replies, signatures, hashtags and emojis. And here is a Hindi message.")
async def s_lab(page):
    await nav(page, "lab")
    await click(page, '.samples button[data-i="2"]')
    await asyncio.sleep(3.5)
    await scroll_to(page, 480, 3)
    await scroll_to(page, 1000, 3)
    await scroll_to(page, 0, 0.6)
    await click(page, '.samples button[data-i="6"]')
    await asyncio.sleep(3.5)
    await scroll_to(page, 480, 3)
    await scroll_to(page, 0, 0.6)
    await click(page, '.samples button[data-i="3"]')
    await asyncio.sleep(3)


@scene("channels", "The channels page simulates WhatsApp, SMS, email, X and the call centre. It uses the same webhook a real gateway would call. I send a WhatsApp message in Hindi, and the bot answers in Hindi.")
async def s_channels(page):
    await nav(page, "channels")
    await click(page, "#msg")
    await page.keyboard.type("नेरुल स्टेशन के पास लाइट बंद है, अंधेरा है", delay=45)
    await asyncio.sleep(0.6)
    await click(page, "#send")
    await asyncio.sleep(4)
    await scroll_to(page, 700, 3)
    await scroll_to(page, 0, 0.5)


@scene("hotspots", "Hotspots uses DBSCAN clustering to find groups of faulty lamps. They usually share one feeder, so a single crew can clear many tickets. "
                   "The repeat failure view shows places where repairs keep coming back, so we fix the cause, and not just the symptom.")
async def s_hotspots(page):
    await nav(page, "hotspots")
    await asyncio.sleep(3)
    await click(page, '#seg button[data-m="recurring"]')
    await asyncio.sleep(3.5)
    await click(page, '#seg button[data-m="risk"]')
    await asyncio.sleep(3)


@scene("predict", "Predictive maintenance uses a gradient boosting model to estimate the chance that each lamp fails in the next fourteen days, and forecasts weekly fault counts with a prediction band. "
                  "The chart on the right shows what drives failures: recent faults, lamp age, and pole condition. Now I drag the rainfall slider, and the risk of the whole network is recalculated instantly. "
                  "The admin can turn the riskiest lamps into preventive work orders before they fail.")
async def s_predict(page):
    await nav(page, "predict")
    await asyncio.sleep(3.5)
    await scroll_to(page, 380, 1.5)
    await glide(page, "#rain")
    for v in (90, 150, 220, 120, 45):
        await page.evaluate("v => { const r = document.querySelector('#rain'); r.value = v; r.dispatchEvent(new Event('input')); }", v)
        await asyncio.sleep(1.4)
    await scroll_to(page, 800, 2)
    await page.locator("#rows input[data-l]:not(:disabled)").nth(0).check()
    await page.locator("#rows input[data-l]:not(:disabled)").nth(1).check()
    await asyncio.sleep(1.2)
    await click(page, "#prev")
    await asyncio.sleep(2.5)


@scene("schedule", "Scheduling compares a manual dispatcher with our optimiser. The optimiser respects each technician's skills and shift length, sends urgent jobs first, and cuts both travel distance and the time to reach critical jobs. "
                   "One click dispatches the plan, and the technicians and citizens are notified.")
async def s_schedule(page):
    await nav(page, "schedule")
    await asyncio.sleep(3.5)
    await click(page, '#mSeg button[data-m="manual"]')
    await asyncio.sleep(3)
    await click(page, '#mSeg button[data-m="opt"]')
    await asyncio.sleep(2.5)
    await scroll_to(page, 360, 3)
    await scroll_to(page, 0, 0.5)
    await click(page, "#disp")
    await page.wait_for_selector("#okb", timeout=5000)
    await asyncio.sleep(1.5)
    await click(page, "#okb")
    await asyncio.sleep(3)


@scene("models", "The Models page is our evidence. The classifier is tested on wordings it never saw during training, and compared with the keyword rules of our first prototype. "
                 "You can see precision and recall for every class, and the confusion matrix. There is also a button to retrain the model using the human corrections. "
                 "We are open about one thing: the training data is synthetic, because no public labelled dataset exists.")
async def s_models(page):
    await nav(page, "models")
    await asyncio.sleep(4)
    await scroll_to(page, 520, 3.5)
    await scroll_to(page, 900, 3)
    await click(page, "#rt")
    await asyncio.sleep(4)


@scene("about", "The system design page shows the architecture in five stages: collect, understand, locate, predict and decide, and act. It also maps every line of the problem statement to a screen in the application.")
async def s_about(page):
    await scroll_to(page, 0, 0.3)
    await nav(page, "about")
    await asyncio.sleep(3.5)
    await scroll_to(page, 420, 4)


@scene("tech", "Finally, the technician. After signing in, they see their optimised route on the map and a job list. They start work, then mark the job fixed with notes and the parts used. The citizen is notified at once, and the ticket closes.")
async def s_tech(page):
    await logout(page)
    await login_as(page, 2)
    await asyncio.sleep(3)
    await click(page, "[data-start]")
    await asyncio.sleep(2.5)
    await click(page, "[data-done]")
    await page.wait_for_selector("#note", timeout=5000)
    await click(page, "#note")
    await page.keyboard.type("Replaced the lamp and tested the driver", delay=40)
    await asyncio.sleep(0.8)
    await click(page, "#ok")
    await asyncio.sleep(3)


@scene("end", "To summarise, Prakash reads complaints in four languages from six channels, finds the exact lamp, scores the danger, predicts failures, optimises crew routes, and learns from human feedback. "
              "It is built with Python and Flask, scikit-learn for the models, and a live browser interface. Thank you. We are happy to take your questions.")
async def s_end(page):
    await scroll_to(page, 0, 0.3)
    await page.evaluate("__card(%r)" % END_CARD)
    await asyncio.sleep(14)


# ------------------------------------------------------------------ speech + muxing
def synth(name, text):
    """Offline text-to-speech with the Windows speech engine -> wav (path)."""
    txt = os.path.join(WORK, f"{name}.txt")
    wav = os.path.join(WORK, f"{name}.wav")
    with open(txt, "w", encoding="utf-8") as fh:
        fh.write(text)
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          f"$s.SelectVoice('{VOICE}'); $s.Rate = 0; $s.SetOutputToWaveFile('{wav}'); "
          f"$s.Speak([IO.File]::ReadAllText('{txt}', [Text.Encoding]::UTF8)); $s.Dispose()")
    subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps], check=True)
    with wave.open(wav) as w:
        return wav, w.getnframes() / w.getframerate()


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    out = []
    for p in parts:  # split very long sentences at commas so captions stay short
        if len(p) > 120:
            bits = re.split(r"(?<=,)\s+", p)
            cur = ""
            for b in bits:
                if len(cur) + len(b) > 110 and cur:
                    out.append(cur.strip())
                    cur = ""
                cur += b + " "
            out.append(cur.strip())
        else:
            out.append(p)
    return out


async def captions(page, text, dur):
    sents = sentences(text)
    total = sum(len(s) for s in sents)
    for s in sents:
        await page.evaluate("t => window.__cap && window.__cap(t)", s)
        await asyncio.sleep(max(1.0, dur * len(s) / total))
    await page.evaluate("window.__cap && window.__cap('')")


async def main():
    os.makedirs(WORK, exist_ok=True)
    for f in os.listdir(WORK):
        os.remove(os.path.join(WORK, f))
    print("Synthesising narration ...")
    audio = []
    for name, text, _ in SCENES:
        wav, dur = synth(name, text)
        audio.append((wav, dur))
        print(f"  {name}: {dur:.1f}s")

    print("Recording ...")
    timeline = []  # (start_seconds, wav)
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True, args=["--force-device-scale-factor=1", "--lang=en-IN"])
        ctx = await browser.new_context(viewport={"width": W, "height": H}, record_video_dir=WORK, record_video_size={"width": W, "height": H}, locale="en-IN")
        await ctx.add_init_script(OVERLAY_JS)
        page = await ctx.new_page()
        t0 = time.time()
        await page.goto(BASE)
        await page.wait_for_selector(".demo-grid")
        await page.evaluate("try{localStorage.setItem('prakash-theme','light')}catch(e){}")
        await page.reload()
        await page.wait_for_selector(".demo-grid")
        await asyncio.sleep(0.8)
        for (name, text, fn), (wav, dur) in zip(SCENES, audio):
            start = time.time() - t0
            timeline.append((start + START_LAG, wav, dur))
            cap = asyncio.create_task(captions(page, text, dur))
            act = asyncio.create_task(fn(page))
            try:
                await act
            except Exception as e:
                print(f"  ! scene {name} action failed: {e}")
            await cap
            wait = start + dur + 0.8 - (time.time() - t0)
            if wait > 0:
                await asyncio.sleep(wait)
            print(f"  scene {name} done at {time.time() - t0:.0f}s")
        total = time.time() - t0 + 1
        await ctx.close()
        video_path = await page.video.path()
        await browser.close()

    print("Mixing audio ...")
    with wave.open(timeline[0][1]) as w0:
        params = w0.getparams()
    rate, width, ch = params.framerate, params.sampwidth, params.nchannels
    frames = bytearray(b"\x00" * int(total * rate) * width * ch)
    for start, wav, dur in timeline:
        with wave.open(wav) as w:
            data = w.readframes(w.getnframes())
        off = int(start * rate) * width * ch
        frames[off:off + len(data)] = data
    mixed = os.path.join(WORK, "narration.wav")
    with wave.open(mixed, "wb") as w:
        w.setparams(params)
        w.writeframes(bytes(frames))

    print("Encoding mp4 ...")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", video_path, "-i", mixed, "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", OUT], check=True)
    print(f"Done: {OUT}  ({total / 60:.1f} min)")


if __name__ == "__main__":
    if sys.platform != "win32":
        sys.exit("This script uses the Windows speech engine.")
    asyncio.run(main())
