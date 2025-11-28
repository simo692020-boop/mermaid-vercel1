
// app/api/render-mermaid/route.ts
// ✅ يعمل محليًا (puppeteer) وعلى Vercel (puppeteer-core + @sparticuz/chromium)
// ✅ runtime NodeJS (Puppeteer لا يعمل على Edge)
// ✅ يرسم Mermaid داخل صفحة HTML ثم يأخذ Screenshot مضبوط بالحجم
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const isVercel = !!process.env.VERCEL;

let puppeteer: any;
let chromium: any;

if (isVercel) {
  // على Vercel نستخدم chromium الخفيف + puppeteer-core
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  puppeteer = require('puppeteer-core');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  chromium = require('@sparticuz/chromium');
} else {
  // محليًا نستخدم puppeteer الكامل الذي يحمّل Chromium تلقائيًا
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  puppeteer = require('puppeteer');
}

// صفحة HTML بسيطة نحقن فيها الـ SVG الناتج
function baseHtml(background = 'transparent', padding = 16) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin:0; padding:0; background:${background}; }
    #wrap { padding:${padding}px; display:inline-block; }
  </style>
</head>
<body>
  <div id="wrap"></div>
  <script>
    // بعض مكتبات تعتمد على process.env
    window.process = { env: { NODE_ENV: 'production' } };
  </script>
</body>
</html>`;
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 400 });
    }

    const payload = await req.json();
    const {
      code,
      theme = 'default',
      background = 'transparent', // 'transparent' أو لون مثل '#ffffff'
      scale = 2,                  // يكبّر الدقة (1–3 عادةً)
      padding = 16,
      fontFamily = 'Inter, Arial, sans-serif'
    } = payload || {};

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Missing "code" (Mermaid DSL string)' }, { status: 400 });
    }

    // تشغيل المتصفح
    let browser: any;
    if (isVercel) {
      const executablePath = await chromium.executablePath();
      browser = await puppeteer.launch({
        args: chromium.args,
        executablePath,
        headless: chromium.headless !== undefined ? chromium.headless : true,
        defaultViewport: { width: 1280, height: 720, deviceScaleFactor: Math.max(1, Number(scale) || 1) }
      });
    } else {
      browser = await puppeteer.launch({
        headless: true,
        defaultViewport: { width: 1280, height: 720, deviceScaleFactor: Math.max(1, Number(scale) || 1) }
      });
    }

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // حمّل الـ HTML الأساسي
    const html = baseHtml(background, padding);
    await page.setContent(html, { waitUntil: ['domcontentloaded', 'networkidle0'] });

    // أضف سكربت Mermaid من CDN
    await page.addScriptTag({
      url: 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js'
    });

    // ارسم الـ SVG داخل #wrap بشكل مباشر باستخدام mermaid.render
    const rect = await page.evaluate(
      async ({ code, theme, fontFamily }) => {
        const mermaid = (window as any).mermaid;
        // تهيئة Mermaid
        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: 'strict',
          fontFamily
        });

        // توليد SVG من الكود
        const { svg } = await mermaid.render('graph-' + Date.now(), code);

        // وضع الـ SVG داخل الصفحة
        const wrap = document.getElementById('wrap')!;
        wrap.innerHTML = svg;

        // ضبط خط الرسم
        const svgEl = wrap.querySelector('svg') as SVGElement | null;
        if (svgEl) {
          (svgEl.style as any).fontFamily = fontFamily;
        }

        // محاولة استخراج الأبعاد بدقة
        let width = 800;
        let height = 400;

        if (svgEl) {
          const viewBox = (svgEl as any).viewBox?.baseVal;
          if (viewBox) {
            width = Math.ceil(viewBox.width);
            height = Math.ceil(viewBox.height);
          } else {
            // Fallback عبر getBBox (قد يفشل أحيانًا)
            try {
              // @ts-ignore
              const bbox = (svgEl as any).getBBox?.();
              if (bbox) {
                width = Math.ceil(bbox.width);
                height = Math.ceil(bbox.height);
              } else {
                const rect = svgEl.getBoundingClientRect();
                if (rect?.width && rect?.height) {
                  width = Math.ceil(rect.width);
                  height = Math.ceil(rect.height);
                }
              }
            } catch (e) {
              const rect = svgEl.getBoundingClientRect();
              if (rect?.width && rect?.height) {
                width = Math.ceil(rect.width);
                height = Math.ceil(rect.height);
              }
            }
          }
        }

        return { width, height };
      },
      { code, theme, fontFamily }
    );

    // ضبط حجم الـ Viewport على حجم الرسم + الحواف
    const width = (rect?.width || 800) + padding * 2;
    const height = (rect?.height || 400) + padding * 2;

    await page.setViewport({
      width,
      height,
      deviceScaleFactor: Math.max(1, Number(scale) || 1)
    });

    // Screenshot لعنصر التغليف
    const container = await page.$('#wrap');
    if (!container) {
      await browser.close();
      return NextResponse.json({ error: 'Failed to render SVG container' }, { status: 500 });
    }

    const buffer: Buffer = await container.screenshot({
      type: 'png',
      omitBackground: background === 'transparent' // يجعل الخلفية شفافة إذا طلبت ذلك
    });

    await browser.close();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err: any) {
    console.error('Mermaid render error:', err);
    try {
      // لو المتصفح مفتوح، أغلقه بأمان
      // @ts-ignore
      if (typeof browser !== 'undefined' && browser) await browser.close();
    } catch {}
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

// (اختياري) GET صحي للتأكد أن المسار شغّال
export async function GET() {
  return NextResponse.json({ ok: true, msg: 'Mermaid renderer is running (POST with {code})' });
}
