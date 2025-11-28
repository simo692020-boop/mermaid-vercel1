
// app/api/render-mermaid/route.ts
// ✅ يعمل محليًا وعلى Vercel بدون أخطاء بناء
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const isVercel = !!process.env.VERCEL;

let puppeteer: any;
let chromium: any;

if (isVercel) {
  // على Vercel: puppeteer-core + @sparticuz/chromium
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  puppeteer = require('puppeteer-core');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  chromium = require('@sparticuz/chromium');
} else {
  // محليًا: puppeteer الكامل
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  puppeteer = require('puppeteer');
}

// HTML أساسي نحقن فيه الناتج لاحقًا
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
    // بعض المكتبات تعتمد على وجود process.env
    window.process = { env: { NODE_ENV: 'production' } };
  </script>
</body>
</html>`;
}

export async function POST(req: Request) {
  let browser: any;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 400 });
    }

    const body = await req.json();
    const {
      code,
      theme = 'default',
      background = 'transparent',
      scale = 2,
      padding = 16,
      fontFamily = 'Inter, Arial, sans-serif'
    } = body || {};

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Missing "code" (Mermaid DSL string)' }, { status: 400 });
    }

    // تشغيل المتصفح حسب البيئة
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

    // تحميل HTML
    const html = baseHtml(background, padding);
    await page.setContent(html, { waitUntil: ['domcontentloaded', 'networkidle0'] });

    // تحميل Mermaid من CDN داخل الصفحة
    await page.addScriptTag({
      url: 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js'
    });

    // ارسم الـ SVG وأعد الأبعاد
    const rect = await page.evaluate(async (params: any) => {
      // @ts-ignore
      const mermaid = window.mermaid;
      mermaid.initialize({
        startOnLoad: false,
        theme: params.theme,
        securityLevel: 'strict',
        fontFamily: params.fontFamily
      });

      const { svg } = await mermaid.render('graph-' + Date.now(), params.code);

      const wrap = document.getElementById('wrap')!;
      wrap.innerHTML = svg;

      const svgEl = wrap.querySelector('svg') as SVGElement | null;
      if (svgEl) {
        (svgEl.style as any).fontFamily = params.fontFamily;
      }

      // حساب الأبعاد بدقة
      let width = 800;
      let height = 400;

      if (svgEl) {
        const vb = (svgEl as any).viewBox?.baseVal;
        if (vb && vb.width && vb.height) {
          width = Math.ceil(vb.width);
          height = Math.ceil(vb.height);
        } else {
          try {
            // @ts-ignore
            const bbox = (svgEl as any).getBBox?.();
            if (bbox && bbox.width && bbox.height) {
              width = Math.ceil(bbox.width);
              height = Math.ceil(bbox.height);
            } else {
              const r = svgEl.getBoundingClientRect();
              if (r?.width && r?.height) {
                width = Math.ceil(r.width);
                height = Math.ceil(r.height);
              }
            }
          } catch {
            const r = svgEl.getBoundingClientRect();
            if (r?.width && r?.height) {
              width = Math.ceil(r.width);
              height = Math.ceil(r.height);
            }
          }
        }
      }

      return { width, height };
    }, { code, theme, fontFamily });

    // ضبط الـ Viewport وتكبير الدقة عبر scale
    const width = (rect?.width || 800) + padding * 2;
    const height = (rect?.height || 400) + padding * 2;

    await page.setViewport({
      width,
      height,
      deviceScaleFactor: Math.max(1, Number(scale) || 1)
    });

    // Screenshot لعنصر #wrap فقط
    const container = await page.$('#wrap');
    if (!container) {
      await browser.close();
      return NextResponse.json({ error: 'Failed to render SVG container' }, { status: 500 });
    }

    const buffer: Buffer = await container.screenshot({
      type: 'png',
      omitBackground: background === 'transparent'
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
      if (browser) await browser.close();
    } catch {}
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

// (اختياري) Endpoint للفحص السريع
export async function GET() {
  return NextResponse.json({ ok: true, msg: 'Mermaid renderer is running (POST with {code})' });
}
