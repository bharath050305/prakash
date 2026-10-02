"""Captures the figures used in the project report.  Needs the server running with fresh demo data.

    python docs/capture_screenshots.py
"""
import asyncio
import os

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "screenshots")
BASE = "http://127.0.0.1:5000"


async def settle(page, s=3.5):
    await asyncio.sleep(s)


async def shot(page, name, y=0, el=None, full=False):
    if y is not None:
        await page.evaluate("y => window.scrollTo(0, y)", y)
        await asyncio.sleep(0.8)
    path = os.path.join(OUT, name + ".png")
    if el:
        await page.locator(el).first.screenshot(path=path)
    else:
        await page.screenshot(path=path, full_page=full)
    print("  ", name)


async def go(page, key):
    await page.evaluate("k => { location.hash = '#/' + k; }", key)
    await settle(page)


async def login(page, idx):
    await page.wait_for_selector(".demo-grid")
    await page.click(f'.demo-grid button[data-i="{idx}"]')
    await page.wait_for_selector("#view")
    await settle(page, 2.5)


async def logout(page):
    await page.click("#logout")
    await page.wait_for_selector(".demo-grid")


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="msedge", headless=True)
        ctx = await b.new_context(viewport={"width": 1366, "height": 820}, device_scale_factor=1.5, locale="en-IN")
        page = await ctx.new_page()
        await page.goto(BASE)
        await page.evaluate("try{localStorage.setItem('prakash-theme','light')}catch(e){}")
        await page.reload()
        await page.wait_for_selector(".demo-grid")
        await asyncio.sleep(1)
        await shot(page, "01_login")

        # ---------------- citizen
        await login(page, 1)
        await shot(page, "02_citizen_home")
        await go(page, "report")
        await page.fill("#txt", "Sparks coming from the pole near Vashi Station and a wire is hanging!")
        await settle(page, 4)
        await shot(page, "03_report_ai_english")
        await page.click('.samples button[data-i="2"]')
        await settle(page, 4)
        await shot(page, "04_report_ai_hinglish")
        await page.click('.samples button[data-i="3"]')
        await settle(page, 4)
        await shot(page, "05_report_ai_hindi")
        await go(page, "tickets")
        await shot(page, "06_citizen_reports")
        # a resolved, rated ticket for the timeline
        href = await page.evaluate("() => { const a=[...document.querySelectorAll('.ticket-card')]; return a.length? a[0].getAttribute('href') : null }")
        await page.click(".ticket-card")
        await settle(page, 3)
        await shot(page, "07_citizen_ticket_detail")
        await go(page, "map")
        await shot(page, "08_city_map")
        await logout(page)

        # ---------------- admin
        await login(page, 0)
        await go(page, "dashboard")
        await shot(page, "09_admin_dashboard")
        await shot(page, "10_admin_dashboard_map", y=330)
        await shot(page, "11_admin_dashboard_charts", y=1000)
        await go(page, "tickets")
        await shot(page, "12_admin_tickets")
        await page.click("#rows tr[data-t]")
        await settle(page, 3)
        await shot(page, "13_ticket_drawer", y=None)
        await page.evaluate("document.querySelector('.drawer').scrollTo(0, 560)")
        await asyncio.sleep(1)
        await shot(page, "14_ticket_drawer_timeline", y=None)
        await page.keyboard.press("Escape")
        await go(page, "review")
        await shot(page, "15_review_queue")
        await go(page, "lab")
        await page.click('.samples button[data-i="6"]')
        await settle(page, 4)
        await shot(page, "16_nlp_lab_pipeline")
        await shot(page, "17_nlp_lab_cleanup", y=470)
        await shot(page, "18_nlp_lab_results", y=1000)
        await go(page, "channels")
        await page.fill("#msg", "नेरुल स्टेशन के पास लाइट बंद है, अंधेरा है")
        await page.click("#send")
        await settle(page, 4)
        await shot(page, "19_channels")
        await go(page, "hotspots")
        await shot(page, "20_hotspots")
        await page.click('#seg button[data-m="recurring"]')
        await settle(page, 2.5)
        await shot(page, "21_hotspots_recurring")
        await go(page, "predict")
        await shot(page, "22_predictive")
        await shot(page, "23_predictive_table", y=760)
        await go(page, "schedule")
        await shot(page, "24_scheduling")
        await shot(page, "25_scheduling_routes", y=480)
        await go(page, "analytics")
        await shot(page, "26_analytics")
        await go(page, "models")
        await shot(page, "27_models")
        await shot(page, "28_models_confusion", y=700)
        await go(page, "alerts")
        await shot(page, "29_alerts")
        await go(page, "team")
        await shot(page, "30_team")
        await go(page, "about")
        await shot(page, "31_system_design")
        # dark theme
        await page.evaluate("document.querySelector('#themeBtn').click()")
        await go(page, "dashboard")
        await shot(page, "32_dashboard_dark")
        await page.evaluate("document.querySelector('#themeBtn').click()")
        await logout(page)

        # ---------------- technician
        await login(page, 2)
        await go(page, "jobs")
        await shot(page, "33_technician_route")
        await b.close()
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
