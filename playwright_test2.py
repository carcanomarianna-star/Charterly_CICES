import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        await page.goto('file:///app/Charterly_CICES.html')
        await asyncio.sleep(1)

        print("Navigated to main application")
        await page.screenshot(path='/app/screenshot11.png', full_page=True)

        await browser.close()

asyncio.run(run())
