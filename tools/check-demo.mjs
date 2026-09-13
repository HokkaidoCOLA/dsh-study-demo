#!/usr/bin/env node
/**
 * 演示动画自检（无头渲染）—— 推送到侧边栏之前必须跑这一条。
 *
 *   node tools/check-demo.mjs <演示.html 路径> [画布CSS宽] [画布CSS高] [最少墨迹]
 *
 * 五项检查，任一不过就以退出码 1 结束（可以直接拿来 gate 推送）：
 *   1. 初始化不抛错       —— 演示自己写进 #err 的错误面板必须是空的
 *   2. 残影              —— 「先画 t0 再画 t1」必须与「干净画布只画 t1」逐像素相同
 *   3. 画面变化（定帧检测）—— 相邻帧画面变化 ≥ 0.8%；只能排除定帧/白屏，
 *                          证明不了「场景本身在动」（游标移动也会通过），真动态靠看图判断
 *   4. 墨迹              —— 非透明像素数达下限，否则是白屏
 *   5. 出界              —— 文字严格（超出 >2px 判失败）；图形宽容（>40px 才判失败）
 *
 * 被检演示必须暴露（这是可复现的关键接口）：
 *   window.__probe = {
 *     setT(t),                  // 必填：把时间轴设到 t 并重绘
 *     frames?: number[],        // 选填：要检查的几个时刻，默认 [0, 中, 末]
 *     tMax?: number,            // 选填：时间轴终点
 *     size?(): [w, h],          // 选填：主画布 CSS 尺寸
 *     chartSize?(): [w, h]      // 选填
 *   }
 * 另外：每帧必须清画布（clearRect），否则残影检查会失败。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'

const HTML = process.argv[2]
if (!HTML) {
  console.error('用法：node tools/check-demo.mjs <演示.html> [宽] [高] [最少墨迹]')
  process.exit(2)
}
const CSSW = Number(process.argv[3] || 400)
const CSSH = Number(process.argv[4] || 240)
const INK_MIN = Number(process.argv[5] || 800)
const DPR = 2
const DYN_MIN = 0.8      // 相邻帧画面变化下限（%）
const TEXT_OUT = 2       // 文字锚点允许超出（px）
const GEOM_OUT = 40      // 图形允许超出（px，图形本来就可能有部分在视口外）

/* ---- 中文字体：没有它，中文会画成豆腐块，「看图」就等于没看 ---- */
const FONT_CANDIDATES = [
  ['/System/Library/Fonts/STHeiti Medium.ttc', 'PingFang SC'],
  ['/System/Library/Fonts/Hiragino Sans GB.ttc', 'PingFang SC'],
  ['/System/Library/Fonts/Supplemental/Songti.ttc', 'PingFang SC']
]
let fontOk = false
for (const [p, family] of FONT_CANDIDATES) {
  try { if (GlobalFonts.registerFromPath(p, family)) { fontOk = true; console.log(`中文字体：✅ ${p}`); break } } catch {}
}
if (!fontOk) console.log('中文字体：⚠️ 一份都没注册上 —— 中文会显示为方块，请先修字体再看图')

/* ---- 沙箱：DOM 桩 + 真 Canvas（只有取过 2D 上下文的元素才算画布）---- */
const CSSVARS = {
  '--fg': '#e6edf3', '--dim': '#8b98a8', '--panel': '#151b24', '--halo': '#141b25', '--grid': '#8ca0be',
  '--water': '#4dabf7', '--glass': '#cfe0f5', '--mark': '#ffd43b', '--ax': '#ff6b6b', '--ay': '#51cf66', '--az': '#4dabf7',
  '--cold': '#4dabf7', '--warm': '#ffa94d', '--front': '#ff6b6b', '--temp': '#ffa94d', '--pres': '#4dabf7', '--rain': '#8ecae6',
  '--liq': '#8ecae6', '--pink': '#ff7ab8', '--ph': '#69db7c', '--jump': '#ffd43b',
  '--axes': '#8ca0be', '--ell': '#4dabf7', '--p': '#ffd43b', '--r1': '#ff6b6b', '--r2': '#69db7c', '--sum': '#ffd43b',
  '--long': '#4dabf7', '--short': '#ffd43b', '--past': '#8b98a8',
  '--story': '#8ca0be', '--ord': '#4dabf7', '--flash': '#ffd43b', '--ins': '#69db7c',
  '--t1': '#ff6b6b', '--t2': '#ffa94d', '--t3': '#ffd43b', '--t4': '#a9e34b',
  '--t5': '#51cf66', '--t6': '#38d9a9', '--t7': '#4dabf7', '--t8': '#b197fc'
}
const src = readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
const fresh = () => ({ ops: 0, texts: 0, clears: 0, minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, tMinX: 1e9, tMaxX: -1e9 })

function wrap(raw, stat) {
  const note = (x, y) => {
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return
    stat.minX = Math.min(stat.minX, x); stat.maxX = Math.max(stat.maxX, x)
    stat.minY = Math.min(stat.minY, y); stat.maxY = Math.max(stat.maxY, y)
  }
  return new Proxy(raw, {
    get(t, k) {
      const v = t[k]
      if (typeof v !== 'function') return v
      if (k === 'moveTo' || k === 'lineTo') return (x, y) => { note(x, y); stat.ops++; return v.call(t, x, y) }
      if (k === 'arc') return (x, y, r, a, b) => { note(x, y); stat.ops++; return v.call(t, x, y, r, a, b) }
      if (k === 'fillText') return (s, x, y) => {
        note(x, y); stat.tMinX = Math.min(stat.tMinX, x); stat.tMaxX = Math.max(stat.tMaxX, x); stat.texts++
        return v.call(t, s, x, y)
      }
      if (k === 'clearRect') { stat.clears++; return (...a) => v.apply(t, a) }
      return (...a) => v.apply(t, a)
    },
    set(t, k, v) { t[k] = v; return true }
  })
}

function makeEnv() {
  const canvases = [], reg = {}
  function makeEl(id) {
    let cv = null, stat = null, proxy = null
    let pw = Math.round(CSSW * DPR), ph = Math.round(CSSH * DPR)
    const el = {
      id, textContent: '', innerHTML: '', value: '', className: '', style: {}, children: [],
      addEventListener() {}, appendChild(c) { this.children.push(c) },
      getContext() {
        if (!cv) {
          cv = createCanvas(Math.max(1, pw), Math.max(1, ph))
          stat = fresh(); proxy = wrap(cv.getContext('2d'), stat)
          canvases.push({ id, get cv() { return cv }, get stat() { return stat } })
        }
        return proxy
      },
      getBoundingClientRect() {
        const h = parseFloat(this.style.height)
        return { width: CSSW, height: isFinite(h) ? h : CSSH, left: 0, top: 0 }
      },
      setPointerCapture() {}, clientWidth: CSSW, clientHeight: CSSH
    }
    Object.defineProperty(el, 'width', { get: () => (cv ? cv.width : pw), set: (v) => { pw = v; if (cv) cv.width = v } })
    Object.defineProperty(el, 'height', { get: () => (cv ? cv.height : ph), set: (v) => { ph = v; if (cv) cv.height = v } })
    return el
  }
  globalThis.window = globalThis
  globalThis.devicePixelRatio = DPR
  globalThis.document = { body: {}, getElementById: (id) => (reg[id] || (reg[id] = makeEl(id))), createElement: (t) => makeEl(t) }
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => CSSVARS[n] || '' })
  globalThis.requestAnimationFrame = () => 0
  globalThis.addEventListener = () => {}
  globalThis.matchMedia = undefined
  globalThis.ResizeObserver = undefined
  new Function(src)()
  const probe = globalThis.__probe
  return { canvases, probe, errText: () => (reg.err ? reg.err.textContent : '') }
}

const px = (cv) => Buffer.from(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data)
const ink = (b) => { let n = 0; for (let i = 3; i < b.length; i += 4) if (b[i] > 0) n++; return n }
function shot(cv, file, bg) {
  const out = createCanvas(cv.width, cv.height)
  const c = out.getContext('2d')
  c.fillStyle = bg; c.fillRect(0, 0, out.width, out.height)
  c.drawImage(cv, 0, 0)
  writeFileSync(file, out.toBuffer('image/png'))
}

/* ---- 命名规范：文件名 = <title>，且符合「科目-册-章节-知识点-编号」---- */
const fileBase = HTML.split('/').pop().replace(/\.html$/, '')
const NAME_RE = /^[^-]+-[^-]+-[^-]+-.+-\d{2}$/
let nameOk = true
if (!NAME_RE.test(fileBase)) {
  nameOk = false
  console.log(`❌ 文件名不符合「科目-册-章节-知识点-编号」：${fileBase}`)
  console.log('   例：数学-选择性必修一-空间向量-空间向量的加减-01（规则见 演示流程.md）')
} else {
  console.log(`命名规范：${fileBase} ✅`)
}
const seg = fileBase.split('-')
const VOLUME_RE = /^(必修[一二三上下册]*|选择性必修[一二三]|选修[一二三]|专题)$/
if (seg.length >= 5 && !VOLUME_RE.test(seg[1])) {
  console.log(`⚠️ 第 2 段「${seg[1]}」既不是教材册名也不是「专题」—— 教材里没有这个内容时应该写「专题」（见 演示流程.md）`)
}
const tm = /<title>([\s\S]*?)<\/title>/.exec(readFileSync(HTML, 'utf8'))
const docTitle = tm ? tm[1].trim() : ''
if (docTitle && docTitle !== fileBase) console.log(`⚠️ <title> 与文件名不一致（<title>=${docTitle}）—— 建议改成同一个字符串，方便以后按名字找文件`)

/* ===================== 跑检查 ===================== */
let bad = 0
if (!nameOk) bad++
const base = makeEnv()
if (!base.probe || typeof base.probe.setT !== 'function') {
  console.log('❌ 没有拿到 window.__probe.setT —— 演示必须暴露这个接口')
  console.log(`   错误面板：${base.errText() || '(空)'}`)
  process.exit(1)
}
const frames = (base.probe.frames && base.probe.frames.length >= 2)
  ? base.probe.frames.slice()
  : [0, (base.probe.tMax || 2) / 2, base.probe.tMax || 2]
console.log(`演示：${HTML}`)
console.log(`画布：${base.probe.size ? base.probe.size().join('×') : CSSW + '×' + CSSH} · 帧 [${frames.join(', ')}]`)
const errText = base.errText()
if (errText) { bad++; console.log(`❌ 错误面板非空：${errText}`) } else console.log('错误面板：空 ✅')

/* 残影 + 墨迹 */
const dirty = makeEnv(); dirty.probe.setT(frames[0]); dirty.probe.setT(frames[frames.length - 1])
const clean = makeEnv(); clean.probe.setT(frames[frames.length - 1])
for (const a of dirty.canvases) {
  const b = clean.canvases.find((c) => c.id === a.id)
  const same = b ? Buffer.compare(px(a.cv), px(b.cv)) === 0 : false
  const n = b ? ink(px(b.cv)) : 0
  if (!same) bad++
  if (n < INK_MIN) bad++
  console.log(`画布 #${a.id}：残影 ${same ? '✅ 一致' : '❌ 有差异'} · 墨迹 ${n} 像素${n < INK_MIN ? ' ❌ 太少（疑似白屏）' : ''}`)
}

/* 动态性 */
const dyn = makeEnv()
let minDiff = 1e9
const diffs = []
for (let i = 0; i + 1 < frames.length; i++) {
  dyn.probe.setT(frames[i]); const a = px(dyn.canvases[0].cv)
  dyn.probe.setT(frames[i + 1]); const b = px(dyn.canvases[0].cv)
  let d = 0
  for (let k = 0; k < a.length; k += 4) if (a[k] !== b[k] || a[k + 1] !== b[k + 1] || a[k + 2] !== b[k + 2]) d++
  const pct = 100 * d / (a.length / 4)
  diffs.push(`${frames[i]}→${frames[i + 1]}: ${pct.toFixed(1)}%`)
  if (pct < minDiff) minDiff = pct
}
if (minDiff < DYN_MIN) bad++
console.log(`画面变化（定帧检测）：${diffs.join(' · ')}`)
console.log(`  → 最小变化 ${minDiff.toFixed(2)}% ${minDiff >= DYN_MIN ? '✅ 不是定帧' : '❌ 几乎没变（定帧/白屏）'}`)
console.log('  ⚠️ 这条只能证明「画面不是定帧」，**证明不了「场景本身在动」**：')
console.log('     游标/高亮移动同样能让像素大块变化。是否真动态，只能靠第 4 步看图判断 ——')
console.log('     判据：把游标和高亮遮住，画面里还剩什么在动？答案是「没有了」就不是动态演示。')

/* 出界 + 出图 */
const outDir = process.argv[6] || 'tools/shots'
try { mkdirSync(outDir, { recursive: true }) } catch {}
const env = makeEnv()
for (const t of frames) {
  for (const c of env.canvases) {
    c.stat.ops = 0; c.stat.texts = 0; c.stat.clears = 0
    c.stat.minX = 1e9; c.stat.maxX = -1e9; c.stat.minY = 1e9; c.stat.maxY = -1e9
    c.stat.tMinX = 1e9; c.stat.tMaxX = -1e9
  }
  env.probe.setT(t)
  const tag = String(t).replace('-', 'n').replace('.', '_')
  for (const c of env.canvases) {
    const w = c.cv.width / DPR, h = c.cv.height / DPR
    const gx = Math.max(0, -c.stat.minX, c.stat.maxX - w), gy = Math.max(0, -c.stat.minY, c.stat.maxY - h)
    const tx = Math.max(0, -c.stat.tMinX, c.stat.tMaxX - w)
    const badG = gx > GEOM_OUT || gy > GEOM_OUT, badT = tx > TEXT_OUT
    if (badG || badT) bad++
    shot(c.cv, `${outDir}/${c.id}-${tag}.png`, '#0f1319')
    console.log(`t=${String(t).padStart(5)} #${c.id} 图元 ${String(c.stat.ops).padStart(4)} 文字 ${String(c.stat.texts).padStart(3)} ` +
      `图形 x[${c.stat.minX.toFixed(0)},${c.stat.maxX.toFixed(0)}] y[${c.stat.minY.toFixed(0)},${c.stat.maxY.toFixed(0)}] / ${w}×${h} ` +
      `${badG ? '⚠ 图形超出 ' + Math.max(gx, gy).toFixed(0) + 'px' : '图形 OK'} · ${badT ? '⚠ 文字被切 ' + tx.toFixed(0) + 'px' : '文字未越界'}`)
  }
}
console.log(`\n${bad === 0 ? '✅ 全部通过 —— 可以推送' : '❌ ' + bad + ' 项失败 —— 不要推送，先修'}`)
console.log(`出图在 ${outDir}/，推送前务必亲眼看一遍关键帧`)
process.exit(bad === 0 ? 0 : 1)
