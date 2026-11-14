window.__ModuleLoader__.load({
  id: 'dsh-composer-cost',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'composer-cost';

    /* ---------------- pricing: CNY per 1,000,000 tokens ---------------- */
    /* DeepSeek public list prices. Peak = Beijing time Mon-Fri, 09:00-12:00 and
       14:00-18:00 (statutory holidays bill at the off-peak rate, which this
       plugin cannot know, so holidays show the peak figure). */
    const PRICES = {
      flash: {
        peak: { hit: 0.04, miss: 2, out: 8 },
        off: { hit: 0.02, miss: 1, out: 4 },
      },
      pro: {
        peak: { hit: 0.3, miss: 9, out: 27 },
        off: { hit: 0.15, miss: 4.5, out: 13.5 },
      },
    };
    const MODEL_ROWS = [
      { test: /(pro|v4\.?pro)/i, row: 'pro' },
      { test: /.*/, row: 'flash' },
    ];

    const SYMBOL = { CNY: '¥', USD: '$' };

    function beijing(ms) {
      const shifted = new Date(ms + 8 * 3600 * 1000);
      return { day: shifted.getUTCDay(), hour: shifted.getUTCHours() };
    }

    function isPeak(ms) {
      const { day, hour } = beijing(ms);
      if (day === 0 || day === 6) return false;
      return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
    }

    function tariffFor(model, ms) {
      const name = typeof model === 'string' ? model : '';
      const row = MODEL_ROWS.find((entry) => entry.test.test(name)).row;
      return { name: row, price: PRICES[row][isPeak(ms) ? 'peak' : 'off'], peak: isPeak(ms) };
    }

    function blank() {
      return { miss: 0, hit: 0, write: 0, out: 0 };
    }

    function add(target, source) {
      target.miss += source.miss;
      target.hit += source.hit;
      target.write += source.write;
      target.out += source.out;
    }

    function fromNodeUsage(usage) {
      if (usage === null || typeof usage !== 'object') return null;
      const bucket = blank();
      bucket.miss = Number(usage.uncachedInputTokens) || 0;
      bucket.hit = Number(usage.cacheReadTokens) || 0;
      bucket.write = Number(usage.cacheWriteTokens) || 0;
      bucket.out = Number(usage.outputTokens) || 0;
      return bucket;
    }

    /* Requests served from cache write are billed at the miss price. */
    function costOf(bucket, tariff) {
      const price = tariff.price;
      return (
        (bucket.miss * price.miss + bucket.write * price.miss + bucket.hit * price.hit + bucket.out * price.out) /
        1000000
      );
    }

    function turnReading(nodes) {
      const result = { tokens: blank(), model: null, time: 0, steps: 0 };
      if (!Array.isArray(nodes)) return result;
      let lastTurn;
      for (const node of nodes) {
        if (node === null || node.kind !== 'assistant') continue;
        if (typeof node.turn !== 'number') continue;
        if (lastTurn === undefined || node.turn > lastTurn) lastTurn = node.turn;
      }
      if (lastTurn === undefined) return result;
      for (const node of nodes) {
        if (node === null || node.kind !== 'assistant' || node.turn !== lastTurn) continue;
        const bucket = fromNodeUsage(node.usage);
        if (bucket === null) continue;
        add(result.tokens, bucket);
        result.steps += 1;
        const completed = node.timing?.completedTime;
        if (typeof completed === 'number' && completed > result.time) result.time = completed;
        const route = Array.isArray(node.usage?.routes) ? node.usage.routes[0] : undefined;
        if (typeof route?.model === 'string' && route.model.length > 0) result.model = route.model;
      }
      return result;
    }

    function sessionReading(nodes, usage) {
      const result = { tokens: blank(), model: null, steps: 0 };
      /* The durable projection carries no route, so the newest routed node
         supplies the model both for the tariff and for the tooltip. */
      if (Array.isArray(nodes)) {
        for (const node of nodes) {
          if (node === null || node.kind !== 'assistant') continue;
          const route = Array.isArray(node.usage?.routes) ? node.usage.routes[0] : undefined;
          if (typeof route?.model === 'string' && route.model.length > 0) result.model = route.model;
        }
      }
      const bucket = fromNodeUsage(usage);
      if (bucket !== null) {
        result.tokens = bucket;
        result.steps = 1;
        return result;
      }
      if (!Array.isArray(nodes)) return result;
      for (const node of nodes) {
        if (node === null || node.kind !== 'assistant') continue;
        const partial = fromNodeUsage(node.usage);
        if (partial === null) continue;
        add(result.tokens, partial);
        result.steps += 1;
      }
      return result;
    }

    function money(value) {
      if (!Number.isFinite(value)) return '—';
      const digits = value !== 0 && Math.abs(value) < 0.1 ? 4 : 2;
      return `¥${value.toFixed(digits)}`;
    }

    function count(value) {
      return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function walletLine(wallet) {
      const symbol = SYMBOL[wallet.currency] ?? `${wallet.currency} `;
      const amount = Number(wallet.balance);
      return Number.isFinite(amount) ? `${symbol}${amount.toFixed(2)}` : `${symbol}${wallet.balance}`;
    }

    function primaryWallet(balance) {
      if (balance === null || typeof balance !== 'object') return null;
      const wallets = Array.isArray(balance.value) ? balance.value : [];
      return wallets.length > 0 ? wallets[0] : null;
    }

    function allWallets(balance) {
      if (balance === null || typeof balance !== 'object') return [];
      const paid = Array.isArray(balance.value) ? balance.value : [];
      const bonus = Array.isArray(balance.bonusWallets) ? balance.bonusWallets : [];
      return [...paid, ...bonus];
    }

    async function readBalance(ctx) {
      try {
        const client = {
          version: globalThis.__DSH_BOOT__?.release?.version ?? '1.0.0',
          locale: ctx.locale.getSnapshot().active,
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        };
        const result = await ctx.remote.account.getBalance(client);
        if (result === null || typeof result !== 'object' || result.ok !== true) return null;
        const value = result.value;
        if (value === null || typeof value !== 'object' || value.status !== 'ready') return null;
        return value;
      } catch {
        return null;
      }
    }

    async function openUsage(ctx) {
      let url = 'https://platform.deepseek.com/usage';
      try {
        const state = await ctx.remote.account.getState();
        const links = state !== null && typeof state === 'object' && state.ok === true ? state.value?.links : undefined;
        if (links !== undefined && typeof links.usageUrl === 'string' && links.usageUrl.length > 0) url = links.usageUrl;
      } catch {
        /* keep the public usage page */
      }
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch {
        /* popup refused by the shell */
      }
    }

    /* The conversation-scoped probe owns the live numbers; the root-scoped
       sidebar control reads them through this tiny store. */
    const liveCost = {
      value: null,
      listeners: new Set(),
      publish(next) {
        this.value = next;
        for (const listener of [...this.listeners]) listener();
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
      get() {
        return this.value;
      },
    };

    /* Portal keeps the popover outside the sidebar's clipping column; without
       react-dom it renders inline instead of failing on click. */
    const ReactDOMGuarded = (() => {
      try {
        return require('react-dom');
      } catch {
        return null;
      }
    })();

    function portalize(node) {
      if (node === null || node === undefined) return null;
      if (ReactDOMGuarded !== null && typeof ReactDOMGuarded.createPortal === 'function') {
        return ReactDOMGuarded.createPortal(node, document.body);
      }
      return node;
    }

    const STYLE = `
.ccost-fbtn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;min-width:32px;padding:0 8px;border:none;border-radius:var(--dsw-radius-md,var(--dsw-radius-sm,6px));background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-variant-numeric:tabular-nums;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.ccost-fbtn:hover{background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);color:var(--dsw-alias-label-primary)}
.ccost-fbtn:active{background:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}
.ccost-fbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.ccost-fbtn svg{flex:none;width:14px;height:14px}
.ccost-fbtn-rail{padding:0}
.ccost-fbtn-label{max-width:104px;overflow:hidden;text-overflow:ellipsis}
.ccost-fbtn-sum{width:168px;max-width:100%;padding:0 6px;justify-content:center;font-size:11px;letter-spacing:.1px}
.ccost-fbtn-sum .ccost-fbtn-label{max-width:none;width:100%;text-align:center}
.ccost-fbtn[data-balance="none"]{color:var(--dsw-alias-state-idle-primary)}
.ccost-wrap{position:relative;display:inline-flex}
.ccost-pop{position:fixed;z-index:90;box-sizing:border-box;padding:12px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 12px 32px rgba(0,0,0,.16);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;text-align:left}
.ccost-pop-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px}
.ccost-pop-t{font-weight:600}
.ccost-pop-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:3px 0}
.ccost-pop-k{color:var(--dsw-alias-label-secondary)}
.ccost-pop-v{font-variant-numeric:tabular-nums;font-weight:600}
.ccost-pop-sub{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.ccost-pop-sep{height:1px;background:var(--dsw-alias-border-l1);margin:8px 0 6px}
.ccost-pop-acts{display:flex;gap:8px;margin-top:10px}
.ccost-pop-btn{flex:1;height:26px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.ccost-pop-btn:hover{background:var(--dsw-alias-bg-layer-2)}
`;

    function appendStyle() {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-composer-cost';
      tag.textContent = STYLE;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }

    const ICON = h(
      'svg',
      { viewBox: '0 0 14 14', 'aria-hidden': true },
      h('circle', {
        cx: 7,
        cy: 7,
        r: 5.4,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        opacity: 0.85,
      }),
      h('path', {
        d: 'M4.9 4.4 7 6.9l2.1-2.5M7 6.9v3.1M5.2 7.6h3.6M5.2 9h3.6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'composer cost: dictionaries');
      ctx.effect(appendStyle, 'composer cost: styles');
      const t = ctx.locale.bind(NS);

      /* Headless probe: mounted with the conversation, publishes the live
         readings for the sidebar foot, renders nothing. */
      const CostProbe = function CostProbe({ useChat, useProjection }) {
        if (typeof useChat !== 'function' || typeof useProjection !== 'function') return null;
        const nodes = useChat((snapshot) => snapshot.legacy.nodes);
        const usage = useProjection('tokenUsage');
        const turn = turnReading(nodes);
        const session = sessionReading(nodes, usage);
        const now = Date.now();
        const turnTariff = tariffFor(turn.model, turn.time > 0 ? turn.time : now);
        const sessionTariff = tariffFor(session.model, now);
        const turnCost = costOf(turn.tokens, turnTariff);
        const sessionCost = costOf(session.tokens, sessionTariff);
        React.useEffect(() => {
          liveCost.publish({ turn, session, turnTariff, sessionTariff, turnCost, sessionCost });
        }, [turn.steps, session.steps, turnCost, sessionCost, turn.time, session.model]);
        return null;
      };

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          { name: 'conversation.composer.dock', id: 'cost', order: 2 },
          CostProbe,
        ),
      );

      /* Sidebar foot: the one place for every reading. The 32px cell matches its
         neighbours, shows the balance inline, and opens the full panel. */
      const FooterBalance = React.memo(function FooterBalance({ wide }) {
        const [reading, setReading] = React.useState({ ready: false, value: null, at: 0 });
        const [busy, setBusy] = React.useState(true);
        const [open, setOpen] = React.useState(false);
        const [pos, setPos] = React.useState(null);
        const [cost, setCost] = React.useState(() => liveCost.get());
        const btnRef = React.useRef(null);
        const panelRef = React.useRef(null);

        React.useEffect(() => liveCost.subscribe(() => setCost(liveCost.get())), []);

        const refresh = React.useCallback(() => {
          setBusy(true);
          return readBalance(ctx).then((value) => {
            setReading({ ready: true, value, at: Date.now() });
            setBusy(false);
            return value;
          });
        }, []);

        React.useEffect(() => {
          refresh();
          const ticker = setInterval(refresh, 120000);
          return () => clearInterval(ticker);
        }, [refresh]);

        React.useEffect(() => {
          if (!open) return undefined;
          const place = () => {
            const node = btnRef.current;
            if (node === null) return;
            const rect = node.getBoundingClientRect();
            const width = 292;
            setPos({
              left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - width - 8)),
              bottom: Math.max(8, window.innerHeight - rect.top + 8),
              width,
            });
          };
          const outside = (event) => {
            if (btnRef.current !== null && btnRef.current.contains(event.target)) return;
            if (panelRef.current !== null && panelRef.current.contains(event.target)) return;
            setOpen(false);
          };
          const escape = (event) => {
            if (event.key === 'Escape') setOpen(false);
          };
          place();
          window.addEventListener('resize', place);
          window.addEventListener('scroll', place, true);
          document.addEventListener('pointerdown', outside, true);
          document.addEventListener('keydown', escape);
          return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', escape);
          };
        }, [open]);

        const wallet = primaryWallet(reading.value);
        const wallets = allWallets(reading.value);
        const turnText = cost === null ? t('action.unknown') : money(cost.turnCost);
        const sessionText = cost === null ? t('action.unknown') : money(cost.sessionCost);
        const walletText =
          wallet !== null ? walletLine(wallet) : reading.ready ? t('action.unknown') : t('action.loading');
        const summary = `${turnText} · ${sessionText} · ${walletText}`;
        const title = [
          `${t('details.turn')} ${turnText}`,
          `${t('details.session')} ${sessionText}`,
          `${t('details.wallets')} ${walletText}`,
          t('action.openUsage'),
        ].join(' · ');
        const tier = (tariff) => t(tariff.peak ? 'tier.peak' : 'tier.off');
        const tokensOf = (bucket) =>
          t('details.tokens', {
            miss: count(bucket.miss),
            hit: count(bucket.hit),
            write: count(bucket.write),
            out: count(bucket.out),
          });
        const row = (label_, value_, key_) =>
          h(
            'div',
            { className: 'ccost-pop-row', key: key_ },
            h('span', { className: 'ccost-pop-k' }, label_),
            h('span', { className: 'ccost-pop-v' }, value_),
          );
        const note = (text_, key_) => h('div', { className: 'ccost-pop-sub', key: key_ }, text_);

        const rows = [];
        if (cost === null) {
          rows.push(note(t('pop.noSession'), 'no-session'));
        } else {
          rows.push(row(t('details.turn'), money(cost.turnCost), 'turn'));
          rows.push(
            note(
              `${tokensOf(cost.turn.tokens)} · ${t('pop.tariff', {
                tier: tier(cost.turnTariff),
                model: cost.turn.model ?? t('model.default'),
              })}`,
              'turn-note',
            ),
          );
          rows.push(row(t('details.session'), money(cost.sessionCost), 'session'));
          rows.push(
            note(
              `${tokensOf(cost.session.tokens)} · ${t('pop.tariff', {
                tier: tier(cost.sessionTariff),
                model: cost.session.model ?? t('model.default'),
              })}`,
              'session-note',
            ),
          );
        }

        const panel = open
          ? h(
              'div',
              {
                ref: panelRef,
                className: 'ccost-pop',
                role: 'dialog',
                'aria-label': t('pop.title'),
                style: pos ?? { visibility: 'hidden' },
              },
              h(
                'div',
                { className: 'ccost-pop-h' },
                h('span', { className: 'ccost-pop-t' }, t('pop.title')),
                h(
                  'span',
                  { className: 'ccost-pop-sub' },
                  busy
                    ? t('action.loading')
                    : reading.at > 0
                      ? t('pop.updated', { time: new Date(reading.at).toLocaleTimeString() })
                      : t('action.unknown'),
                ),
              ),
              rows,
              h('div', { className: 'ccost-pop-sep' }),
              row(t('details.wallets'), wallet === null ? t('action.unknown') : walletLine(wallet), 'wallet'),
              wallets.length > 1 ? note(wallets.map(walletLine).join(' · '), 'wallet-note') : null,
              h(
                'div',
                { className: 'ccost-pop-acts' },
                h(
                  'button',
                  { type: 'button', className: 'ccost-pop-btn', onClick: () => void refresh() },
                  busy ? t('action.loading') : t('pop.refresh'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'ccost-pop-btn', onClick: () => void openUsage(ctx) },
                  t('pop.usage'),
                ),
              ),
            )
          : null;

        return h(
          'span',
          { className: 'ccost-wrap' },
          h(
            'button',
            {
              ref: btnRef,
              type: 'button',
              className: wide ? 'ccost-fbtn ccost-fbtn-sum' : 'ccost-fbtn ccost-fbtn-rail',
              title,
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              'aria-label': `${t('action.label')} ${summary}`,
              'data-balance': wallet === null ? 'none' : 'ready',
              onClick: () => setOpen(!open),
            },
            wide ? h('span', { className: 'ccost-fbtn-label' }, summary) : ICON,
          ),
          portalize(panel),
        );
      });

      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'balance', order: 10, label: () => t('action.label') },
          FooterBalance,
        ),
      );
    }

    const en = {
      'line.turn': 'Turn {value}',
      'line.session': 'Session {value}',
      'line.balance': 'Balance {value}',
      'tier.peak': 'peak',
      'tier.off': 'off-peak',
      'model.default': 'default model',
      'details.turn': 'This turn',
      'details.session': 'This session',
      'details.tokens': 'Input {miss} · cache hit {hit} · cache write {write} · output {out}',
      'details.tariff': 'Tariff: {tier} ({model})',
      'details.wallets': 'Account wallet',
      'details.noAccount': 'Account balance unavailable (not signed in, or the read failed).',
      'details.pricing': 'Prices follow the DeepSeek list price in CNY; peak hours are Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00.',
      'action.label': 'Balance',
      'action.loading': '…',
      'action.unknown': '—',
      'action.unknownHint': 'Balance unavailable (not signed in, or the read failed).',
      'action.wallets': 'Wallets',
      'action.openUsage': 'Click to refresh the balance and open the usage page.',
      'pop.title': 'Cost & balance',
      'pop.updated': 'updated {time}',
      'pop.refresh': 'Refresh',
      'pop.usage': 'Usage page',
      'pop.noSession': 'Open a conversation to see this turn and the session total.',
      'pop.tariff': '{tier} · {model}',
    };

    const zh = {
      'line.turn': '本轮 {value}',
      'line.session': '会话 {value}',
      'line.balance': '余额 {value}',
      'tier.peak': '高峰价',
      'tier.off': '空闲价',
      'model.default': '默认模型',
      'details.turn': '本轮对话',
      'details.session': '整个会话',
      'details.tokens': '输入 {miss} · 缓存命中 {hit} · 缓存写入 {write} · 输出 {out}',
      'details.tariff': '计费：{tier}（{model}）',
      'details.wallets': '账号钱包',
      'details.noAccount': '余额读取不到（未登录，或请求失败）。',
      'details.pricing': '单价按 DeepSeek 官网人民币价目；高峰时段为北京时间周一至周五 09:00–12:00、14:00–18:00。',
      'action.label': '余额',
      'action.loading': '…',
      'action.unknown': '—',
      'action.unknownHint': '余额读取不到（未登录，或请求失败）。',
      'action.wallets': '钱包',
      'action.openUsage': '点击刷新余额并打开用量页面。',
      'pop.title': '花费与余额',
      'pop.updated': '更新于 {time}',
      'pop.refresh': '刷新',
      'pop.usage': '用量页',
      'pop.noSession': '打开一个会话才能看到本轮花费与会话累计。',
      'pop.tariff': '{tier} · {model}',
    };

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account'],
      apply,
    };
  },
});
