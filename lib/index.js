/**
 * dsh-study-demo，Node 侧：注册 `demo` 工具。
 *
 * 工具只做一件事：把模型写好的完整 HTML 演示落到工作区的 `.dsh-demo/` 下，
 * 并把最终路径通过结果元数据（presentationMeta）交给浏览器侧。浏览器侧
 * （`lib/client.js`）注册同名工具视图，在调用落定的那一刻调用 `openFile()`，
 * 于是右侧边栏自动展开并渲染这份 HTML。
 *
 * 文件名由「标题 slug + 内容哈希」决定：同一份演示重复调用落到同一个地址，
 * 侧边栏里是同一个标签页（幂等，不会堆叠）；内容变了就是新地址、新标签页。
 *
 * 配置只有一项 `maxHtmlBytes`（见 `Config`）；插件开关交给 loader 的
 * `disabled` 字段处理，不在这里做 enabled 开关。
 *
 * @module @dsh-external/dsh-study-demo
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'

/** Cordis 插件名。 */
export const name = 'dsh-study-demo'

/** 必需服务：工具注册表与文件系统接缝。 */
export const inject = ['tools', 'fs']

/** 演示文件落盘的目录（相对工作区根），以点开头避免干扰用户的工作区视图。 */
export const DEMO_DIR = '.dsh-demo'

/** 单份演示 HTML 的字节上限（`Config.maxHtmlBytes` 的默认值）。 */
export const MAX_HTML_BYTES = 800_000

/**
 * 配置默认值：直接用 `demoTool(ctx)` 调用（不经 loader 校验）时的兜底。
 */
const DEFAULT_CONFIG = { maxHtmlBytes: MAX_HTML_BYTES }

/**
 * 配置声明：loader 在挂载前校验入口 config 并填入默认值。
 *
 * 只开放 `maxHtmlBytes`：目录名 `DEMO_DIR` 必须与浏览器侧 `lib/client.js`
 * 里的同名常量一致，改它会让自动打开失效，所以不做成配置项。
 */
export const Config = Schema.object({
	maxHtmlBytes: Schema.number().min(1_000).max(8_000_000).step(1).default(MAX_HTML_BYTES)
})

/**
 * 把标题压成文件名：**保留中文**，只清掉文件名非法字符（`/ \ : * ? " < > |`
 * 与控制符），空白折成 `-`，最长 80 字符。
 *
 * 标题必须按「科目-册-章节-知识点-编号」命名（例：
 * `数学-选择性必修一-空间向量-空间向量的加减-01`），所以文件名本身就是
 * 一份可读的索引。命名规则见工作区的 `演示流程.md`。
 *
 * @param title - 演示标题。
 * @returns 非空 slug。
 */
export function slugOf(title) {
	const slug = String(title ?? '')
		.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, '-')
		.replace(/\s+/gu, '-')
		.replace(/-{2,}/gu, '-')
		.replace(/^[-.]+|[-.]+$/gu, '')
		.slice(0, 80)
	return slug.length > 0 ? slug : 'demo'
}

/**
 * 演示内容的相对落盘路径，浏览器侧用同一算法重建。
 *
 * 文件名 = 标题（去掉非法字符），**不带内容哈希**：同一标题重复推送覆盖同一个
 * 文件、侧边栏里是同一个标签页。内容变了要换编号（`-01` → `-02`），不要用
 * 同一个标题覆盖 —— 这条也是 `演示流程.md` 里的硬规则。
 *
 * @param title - 演示标题。
 * @returns 演示 HTML 的相对路径。
 */
export function demoPathOf(title) {
	return `${DEMO_DIR}/${slugOf(title)}.html`
}

/** 结果元数据判别标签，浏览器侧据此认领。 */
export const DEMO_META_KIND = 'study-demo'

const DESCRIPTION = [
	'把一份自包含的 HTML 演示推送到用户 DSH 界面的右侧边栏并自动展开。',
	'用于讲解题目、知识点或原理时给出可交互的 2D/3D 可视化：几何图形与变换、函数图像与参数联动、向量与受力分析、立体几何与旋转体、物理过程动画、公式或算法的分步演示。',
	'调用后用户立刻在侧边栏看到演示，对话区仍然留给讲解文字，二者并排。',
	'',
	'写作要求：',
	'- `html` 必须是完整 HTML 文档（以 `<!doctype html>` 开头），样式写在 `<style>` 里，脚本写在 `<script>` 里。',
	'- 演示页面运行在不透明来源的 sandbox iframe 中：可以用 Canvas 2D、WebGL2、requestAnimationFrame、pointer 事件；不能访问宿主页面、localStorage 或父窗口。',
	'- 3D 用 three.js：在内联脚本里 `import("https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js")`（动态 import，带 try/catch 降级）。',
	'- 页面宽度可能只有 300–500px，按窄栏纵向排布设计，不要依赖宽屏横向布局。',
	'- 用 `prefers-color-scheme` 适配明暗主题，或直接用深色底。'
].join('\n')

/**
 * `demo` 工具定义。
 * @param ctx - 注册它的上下文。
 * @param config - 已校验的配置；缺省用内置默认值。
 * @returns 可注册的工具定义。
 */
export function demoTool(ctx, config = DEFAULT_CONFIG) {
	const maxHtmlBytes = config.maxHtmlBytes ?? MAX_HTML_BYTES
	return defineTool({
		name: 'demo',
		description: DESCRIPTION,
		parameters: {
			title: {
				type: 'string',
				description: '演示标题，显示在侧边栏标签页和工具卡片上，例如「二次函数 y=ax²+bx+c 的顶点与开口」。'
			},
			html: {
				type: 'string',
				description: '完整 HTML 文档（含 `<!doctype html>`）。样式与脚本自包含。'
			},
			focus: {
				type: 'string',
				description: '一句话说明这份演示在展示什么，显示在工具卡片上，例如「拖动 a 看开口方向与顶点轨迹」。'
			}
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					path: { type: 'string', required: true },
					title: { type: 'string', required: true },
					focus: { type: 'string', required: true },
					sizeBytes: { type: 'integer', required: true }
				}
			},
			render: (_args, value) => [{
				type: 'text',
				text: `演示「${value.title}」已推送到右侧边栏（${value.sizeBytes} 字节，文件 ${value.path}）。${value.focus}`
			}],
			presentationMeta: (_args, value) => ({
				kind: DEMO_META_KIND,
				path: value.path,
				title: value.title,
				focus: value.focus
			})
		},
		isConcurrencySafe: () => false,
		async execute(args, exec) {
			const title = typeof args.title === 'string' && args.title.trim().length > 0
				? args.title.trim()
				: '演示'
			const focus = typeof args.focus === 'string' ? args.focus.trim() : ''
			const html = args.html
			if (typeof html !== 'string' || html.trim().length === 0) {
				throw new Error('invalid demo: `html` 不能为空，必须是完整 HTML 文档')
			}
			const sizeBytes = Buffer.byteLength(html, 'utf8')
			if (sizeBytes > maxHtmlBytes) {
				throw new Error(
					`invalid demo: html 为 ${sizeBytes} 字节，超过上限 ${maxHtmlBytes}；请把内联数据下采样或改为程序生成（上限可用插件配置 maxHtmlBytes 调整）`
				)
			}

			const sandboxPolicy = ctx.get('sandboxPolicy')?.resolve({
				...exec.agent ? { session: exec.agent.session } : {}
			})
			const cwd = sandboxPolicy?.workspaceRoot ?? exec.agent?.session.header.cwd
			const resolveOpts = {
				...cwd !== undefined ? { cwd } : {},
				signal: exec.signal
			}

			const target = await ctx.fs.resolve(demoPathOf(title), resolveOpts)
			await ctx.fs.writeText(target, html, undefined, exec.signal, sandboxPolicy)

			return { path: target.displayPath, title, focus, sizeBytes }
		},
		presentCall: () => ({
			card: 'generic',
			title: '演示',
			kind: 'other'
		}),
		presentResult(_args, result) {
			if (result.isError) return undefined
			return { card: 'generic', title: '演示 · 已推送到侧边栏' }
		}
	})
}

/**
 * 注册 `demo` 工具。
 * @param ctx - 注册它的上下文。
 * @param config - loader 校验后的配置（可缺省）。
 */
export function apply(ctx, config) {
	ctx.tools.register(demoTool(ctx, { ...DEFAULT_CONFIG, ...config }))
}
