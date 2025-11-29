
// app/api/render-mermaid/route.ts
import type { NextRequest } from 'next/server'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

// مهم جداً: Puppeteer لا يعمل على Edge Runtime
export const runtime = 'nodejs'
// ارفع المدّة حسب الحاجة وخطتك على Vercel
export const maxDuration = 15

export async function POST(req: NextRequest) {
  try {
    const { code, theme = 'default', scale = 2, transparent = false } = await req.json()

    // تحسينات أداء على السيرفرلس
    chromium.setGraphicsMode = false

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    })

    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: scale })

    // نبني صفحة صغيرة تشغّل Mermaid وتحوّله إلى SVG
    await page.setContent(
      `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>html,body{margin:0;padding:0}</style>
          <script src="https://unpkg.com/mermaid@10/dist/mermaidpt>
        </head>
        <body>
          <div id="container" class="mermaid">${code}</div>
          <script>
            mermaid.initialize({ startOnLoad: true, theme: '${theme}' });
          </script>
        </body>
      </html>
      `,
      { waitUntil: 'domcontentloaded' }
    )

    // انتظار توليد الـ SVG
    await page.waitForSelector('#container svg', { timeout: 10_000 })

    // لقطة PNG (مع الخلفية الشفّافة حسب الطلب)
    const png = await page.screenshot({ type: 'png', omitBackground: transparent })

    await browser.close()

    return new Response(png, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'Render failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

