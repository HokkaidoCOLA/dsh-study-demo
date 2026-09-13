/**
 * dsh-study-demo —— 学习演示面板（宿主侧类型声明）。
 *
 * 插件做一件事：注册 `demo` 工具，把模型给的自包含 HTML 演示写到工作区的
 * `.dsh-demo/` 下，路径经结果元数据（`presentationMeta`，判别标签
 * {@link DEMO_META_KIND}）交给浏览器侧 `lib/client.js`；浏览器侧用它调用框架的
 * `openFile()`，右侧边栏随调用落定自动展开。
 *
 * 路径规则：`${DEMO_DIR}/${slug(title)}.html`——**文件名就是标题**（保留中文，只清掉
 * 文件名非法字符），不带内容哈希。标题必须按「科目-册-章节-知识点-编号」命名
 * （例：`数学-选择性必修一-空间向量-空间向量的加减-01`），这样 `.dsh-demo/` 本身就是
 * 一份可读的索引；内容变了要换编号，不要用同一标题覆盖。浏览器侧用同名算法重建
 * 该路径，两侧必须保持一致。命名规则见工作区的 `演示流程.md`。
 *
 * @module @dsh-external/dsh-study-demo
 */

import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Cordis 插件名。 */
export declare const name: 'dsh-study-demo'

/** 必需服务：工具注册表与文件系统接缝。 */
export declare const inject: string[]

/** 插件配置。 */
export interface Config {
	/**
	 * 单份演示 HTML 的字节上限（默认 {@link MAX_HTML_BYTES} = 800000）。
	 *
	 * 超限时 `demo` 工具直接报错，不会落盘；调大它可以让更大的内联数据通过，
	 * 但侧边栏渲染的是完整 HTML 文档，过大只会拖慢打开速度。
	 */
	maxHtmlBytes: number
}

/** 配置声明：loader 在挂载前校验入口 config 并填入默认值。 */
export declare const Config: Schema<Config>

/** 演示文件落盘的目录（相对工作区根），浏览器侧同名常量必须一致。 */
export declare const DEMO_DIR: '.dsh-demo'

/** 单份演示 HTML 的字节上限默认值（即 `Config.maxHtmlBytes` 的默认值）。 */
export declare const MAX_HTML_BYTES: 800000

/** 结果元数据判别标签，浏览器侧据此认领这次调用。 */
export declare const DEMO_META_KIND: 'study-demo'

/**
 * 把标题压成文件名：保留中文，只清掉文件名非法字符（`/ \ : * ? " < > |` 与控制符）
 * 与空白，最长 80 字符。
 *
 * @param title - 演示标题（按「科目-册-章节-知识点-编号」命名）。
 * @returns 非空 slug。
 */
export declare function slugOf(title: unknown): string

/**
 * 演示内容的相对落盘路径，浏览器侧用同一算法重建。
 *
 * @param title - 演示标题。
 * @returns 形如 `.dsh-demo/数学-选择性必修一-空间向量-空间向量的加减-01.html` 的相对路径。
 */
export declare function demoPathOf(title: unknown): string

/**
 * 构造 `demo` 工具定义。
 *
 * @param ctx - 注册它的上下文（需已注入 `tools` 与 `fs`）。
 * @param config - 已校验的配置；缺省时用内置默认值。
 * @returns 可交给 `ctx.tools.register` 的工具定义。
 */
export declare function demoTool(ctx: Context, config?: Partial<Config>): ToolDefinition

/**
 * 注册 `demo` 工具。
 *
 * @param ctx - 注册它的上下文。
 * @param config - loader 校验后的配置；可缺省或为 null。
 */
export declare function apply(ctx: Context, config?: Partial<Config> | null): void
