#!/usr/bin/env node
/**
 * 演示排错：自检只报「哪一项没过」，这个脚本把演示自己抓到的错误原文打出来。
 * 用法：node tools/diag-demo.mjs <演示.html> [时刻]
 * 适用症状：自检报「动态性 0.00% / 图元 0 / 墨迹很少」—— 十有八九是首帧就抛错了。
 */
import { readFileSync } from 'node:fs'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'

const HTML = process.argv[2]
const AT = process.argv[3] === undefined ? null : Number(process.argv[3])
if (!HTML) { console.error('用法：node tools/diag-demo.mjs <演示.html> [时刻]'); process.exit(2) }

for (const p of ['/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc']) {
  try { if (GlobalFonts.registerFromPath(p, 'PingFang SC')) break } catch {}
}

const src = readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
const els = {}
function makeEl(id) {
  const cv = createCanvas(800, 560)
  const raw = cv.getContext('2d')
  const el = {
    id, textContent: '', innerHTML: '', value: '', className: '', style: {}, children: [],
    addEventListener() {}, appendChild(c) { this.children.push(c) },
    getContext() { return raw },
    getBoundingClientRect() { return { width: 400, height: 260, left: 0, top: 0 } },
    setPointerCapture() {}, clientWidth: 400, clientHeight: 260
  }
  Object.defineProperty(el, 'width', { get: () => cv.width, set: (v) => { cv.width = v } })
  Object.defineProperty(el, 'height', { get: () => cv.height, set: (v) => { cv.height = v } })
  els[id] = el
  return el
}
globalThis.window = globalThis
globalThis.devicePixelRatio = 2
globalThis.document = { body: {}, getElementById: (id) => (els[id] || makeEl(id)), createElement: (t) => makeEl(t) }
globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => ({
  '--fg': '#e6edf3', '--dim': '#8b98a8', '--panel': '#151b24', '--halo': '#141b25', '--grid': '#8ca0be'
}[n] || '') })
globalThis.requestAnimationFrame = () => 0
globalThis.addEventListener = () => {}
globalThis.matchMedia = undefined
globalThis.ResizeObserver = undefined

try { new Function(src)() } catch (e) { console.log('初始化直接抛错：', e && e.stack || e) }
console.log('错误面板：', JSON.stringify(els.err ? els.err.textContent : '(没有 #err 元素)'))
const probe = globalThis.__probe
if (!probe) { console.log('没有 window.__probe —— 演示没暴露自检接口'); process.exit(1) }
for (const t of (AT === null ? (probe.frames || [0]) : [AT])) {
  try { probe.setT(t); console.log(`setT(${t}) 正常`) }
  catch (e) { console.log(`setT(${t}) 抛错：`, e && e.message) }
}
console.log('错误面板（跑完首帧后）：', JSON.stringify(els.err ? els.err.textContent : ''))
