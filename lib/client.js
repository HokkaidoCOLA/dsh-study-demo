/**
 * dsh-study-demo，浏览器侧。
 *
 * 注册 `demo` 工具的工具视图：调用一落定，就调用框架给的 `openFile()`，
 * 于是右侧边栏自动展开并渲染那份 HTML 演示。这是本插件全部的作用——
 * 渲染、沙箱、主题全部复用内置的 HTML 预览标签页，这里不自己画。
 *
 * 交付方式是 `window.__ModuleLoader__.load` 的 CJS 工厂模块（与 dsh-visualize
 * 同格式），因此本包不需要任何打包步骤。运行时只 require 宿主的 `react`。
 */

window.__ModuleLoader__.load({
	id: '@dsh-external/dsh-study-demo',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		var react = require('react');

		/** 本页打开的时刻：早于它的调用是历史重放，不触发自动打开。 */
		var PAGE_OPENED_AT = Date.now();
		/** 自动打开的时间窗口：调用落定时刻距页面打开不超过这么久。 */
		var FRESH_WINDOW_MS = 10000;

		var DEMO_META_KIND = 'study-demo';
		var DEMO_DIR = '.dsh-demo';

		/**
		 * 标题 → 文件名，与 Node 侧 `slugOf` **完全一致**：保留中文，只清掉文件名
		 * 非法字符（`/ \ : * ? " < > |` 与控制符）和空白。
		 * @param {unknown} title - 演示标题。
		 * @returns {string} 非空 slug。
		 */
		function slugOf(title) {
			var slug = String(title == null ? '' : title)
				.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, '-')
				.replace(/\s+/gu, '-')
				.replace(/-{2,}/gu, '-')
				.replace(/^[-.]+|[-.]+$/gu, '')
				.slice(0, 80);
			return slug.length > 0 ? slug : 'demo';
		}

		/**
		 * 从调用参数重建描述子：结果元数据丢失时（历史重放、旧日志）的兜底。
		 * @param {unknown} argsRaw - 工具调用的原始参数 JSON。
		 * @returns {{path: string|undefined, title: string, focus: string}} 描述子。
		 */
		function fromArgs(argsRaw) {
			var fallback = { path: undefined, title: '演示', focus: '' };
			if (typeof argsRaw !== 'string' || argsRaw.length === 0) return fallback;
			var args;
			try {
				args = JSON.parse(argsRaw);
			} catch (error) {
				return fallback;
			}
			if (args === null || typeof args !== 'object') return fallback;
			var html = typeof args.html === 'string' ? args.html : '';
			var title = typeof args.title === 'string' && args.title.trim().length > 0
				? args.title.trim()
				: '演示';
			return {
				path: html.length > 0 ? DEMO_DIR + '/' + slugOf(title) + '.html' : undefined,
				title: title,
				focus: typeof args.focus === 'string' ? args.focus.trim() : ''
			};
		}

		/**
		 * 把一次调用的运行中或已落定形态归一成渲染所需的描述子。
		 * @param {object|undefined} block - 工具调用块。
		 * @returns {{path: string|undefined, title: string, focus: string, settled: boolean, isError: boolean, time: number}} 描述子。
		 */
		function descriptorOf(block) {
			if (block !== null && typeof block === 'object' && block.kind === 'tool-result') {
				var meta = block.meta;
				var base = meta !== null && typeof meta === 'object' && meta.kind === DEMO_META_KIND &&
					typeof meta.path === 'string'
					? {
						path: meta.path,
						title: typeof meta.title === 'string' ? meta.title : '演示',
						focus: typeof meta.focus === 'string' ? meta.focus : ''
					}
					: fromArgs(block.call === null || block.call === undefined ? undefined : block.call.argsRaw);
				return {
					path: base.path,
					title: base.title,
					focus: base.focus,
					settled: true,
					isError: block.isError === true,
					time: typeof block.time === 'number' ? block.time : 0
				};
			}
			var running = fromArgs(block === null || block === undefined ? undefined : block.argsRaw);
			return {
				path: running.path,
				title: running.title,
				focus: running.focus,
				settled: false,
				isError: false,
				time: block !== null && typeof block === 'object' && typeof block.time === 'number' ? block.time : 0
			};
		}

		/** 卡片外层样式，用半透明灰以同时适配明暗主题。 */
		var CARD_STYLE = {
			display: 'flex',
			flexDirection: 'column',
			gap: '5px',
			border: '1px solid rgba(128,128,128,0.28)',
			background: 'rgba(128,128,128,0.08)',
			borderRadius: '10px',
			padding: '9px 12px',
			margin: '2px 0',
			color: 'inherit'
		};
		var TITLE_STYLE = { fontWeight: 600, fontSize: '13px', lineHeight: 1.4 };
		var FOCUS_STYLE = { fontSize: '12px', opacity: 0.72, lineHeight: 1.5 };
		var STATUS_STYLE = { fontSize: '12px', opacity: 0.6, lineHeight: 1.5 };
		var ROW_STYLE = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' };
		var BUTTON_STYLE = {
			padding: '3px 10px',
			fontSize: '12px',
			borderRadius: '6px',
			border: '1px solid rgba(128,128,128,0.4)',
			background: 'transparent',
			color: 'inherit',
			cursor: 'pointer',
			font: 'inherit'
		};

		/**
		 * `demo` 工具的工具视图：落定即把演示推上右侧边栏。
		 * @param {object} props - 框架提供的 owner 属性。
		 * @returns {object} React 元素。
		 */
		function DemoCard(props) {
			var descriptor = descriptorOf(props.block);
			var path = descriptor.path;
			var openable = typeof path === 'string' && path.length > 0 && !descriptor.isError;
			var opened = react.useRef(null);

			// 只在「本次页面会话里刚刚落定」的调用上自动打开：
			// 打开历史会话时重放出来的旧卡片不会再把侧边栏弹开。
			var fresh = descriptor.time >= PAGE_OPENED_AT - FRESH_WINDOW_MS;

			react.useEffect(function () {
				if (!openable || !descriptor.settled || !fresh) return;
				if (opened.current === path) return;
				opened.current = path;
				try {
					props.openFile(path);
				} catch (error) {
					// 打开失败不影响卡片本身；用户仍可用下面的按钮重试。
				}
			}, [openable, descriptor.settled, fresh, path]);

			var children = [];
			children.push(react.createElement('div', { key: 'title', style: TITLE_STYLE }, '演示 · ' + descriptor.title));
			if (descriptor.focus.length > 0) {
				children.push(react.createElement('div', { key: 'focus', style: FOCUS_STYLE }, descriptor.focus));
			}

			var status;
			if (descriptor.isError) status = '演示生成失败';
			else if (!descriptor.settled) status = '正在生成演示…';
			else if (openable) status = fresh ? '已自动在右侧边栏打开' : '已在右侧边栏打开过（可重新打开）';
			else status = '没有可打开的演示文件';
			children.push(react.createElement('div', { key: 'status', style: STATUS_STYLE }, status));

			if (openable) {
				children.push(react.createElement(
					'div',
					{ key: 'actions', style: ROW_STYLE },
					react.createElement('button', {
						type: 'button',
						style: BUTTON_STYLE,
						onClick: function () {
							try {
								props.openFile(path);
							} catch (error) {
								// 静默：下一次点击会重试。
							}
						}
					}, '在侧边栏打开')
				));
			}

			return react.createElement('div', { style: CARD_STYLE }, children);
		}

		/** Client 插件名。 */
		var name = 'dsh-study-demo';
		/** 必需服务：槽位注册表。 */
		var inject = ['slots'];

		/**
		 * 注册 `demo` 的工具视图。
		 * @param {object} ctx - client 根上下文。
		 */
		function apply(ctx) {
			ctx.slots.inject('tool.call.toolview', function () {
				return ctx.slots.register(
					{ name: 'tool.call.toolview', key: 'demo' },
					DemoCard
				);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
