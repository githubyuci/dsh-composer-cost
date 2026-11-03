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

    const STYLE = `
.ccost-anchor{order:5;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex;min-width:0}
.ccost-pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;padding:1px 8px;max-width:100%;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:default}
.ccost-pill svg{flex:none;width:14px;height:14px}
.ccost-label{overflow:hidden;text-overflow:ellipsis;min-width:0}
.ccost-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}
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

    function joined(parts) {
      const children = [];
      parts.forEach((part, index) => {
        if (index > 0) children.push(h('span', { className: 'ccost-sep', key: `sep:${index}` }, '·'));
        children.push(h('span', { className: 'ccost-label', key: `part:${index}` }, part));
      });
      return children;
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'composer cost: dictionaries');
      ctx.effect(appendStyle, 'composer cost: styles');
      const t = ctx.locale.bind(NS);

      const CostPill = React.memo(function CostPill({ useChat, useProjection }) {
        if (typeof useChat !== 'function' || typeof useProjection !== 'function') return null;
        const nodes = useChat((snapshot) => snapshot.legacy.nodes);
        const usage = useProjection('tokenUsage');
        const [balance, setBalance] = React.useState(null);
        const stamp =
          usage === undefined || usage === null
            ? 0
            : (Number(usage.outputTokens) || 0) +
              (Number(usage.uncachedInputTokens) || 0) +
              (Number(usage.cacheReadTokens) || 0);

        React.useEffect(() => {
          let alive = true;
          const read = () => {
            void readBalance(ctx).then((value) => {
              if (alive) setBalance(value);
            });
          };
          read();
          const ticker = setInterval(read, 60000);
          return () => {
            alive = false;
            clearInterval(ticker);
          };
        }, [stamp]);

        const turn = turnReading(nodes);
        const session = sessionReading(nodes, usage);
        const now = Date.now();
        const turnTariff = tariffFor(turn.model, turn.time > 0 ? turn.time : now);
        const sessionTariff = tariffFor(session.model, now);
        const turnCost = costOf(turn.tokens, turnTariff);
        const sessionCost = costOf(session.tokens, sessionTariff);
        const wallet = primaryWallet(balance);

        if (turn.steps === 0 && session.steps === 0 && wallet === null) return null;

        const parts = [
          t('line.turn', { value: money(turnCost) }),
          t('line.session', { value: money(sessionCost) }),
        ];
        if (wallet !== null) parts.push(t('line.balance', { value: walletLine(wallet) }));

        const tier = (tariff) => t(tariff.peak ? 'tier.peak' : 'tier.off');
        const tokens = (bucket) =>
          t('details.tokens', {
            miss: count(bucket.miss),
            hit: count(bucket.hit),
            write: count(bucket.write),
            out: count(bucket.out),
          });
        const wallets = allWallets(balance);
        const title = [
          `${t('details.turn')}\n${tokens(turn.tokens)}\n${t('details.tariff', {
            tier: tier(turnTariff),
            model: turn.model ?? t('model.default'),
          })} — ${money(turnCost)}`,
          `${t('details.session')}\n${tokens(session.tokens)}\n${t('details.tariff', {
            tier: tier(sessionTariff),
            model: session.model ?? t('model.default'),
          })} — ${money(sessionCost)}`,
          wallets.length > 0
            ? `${t('details.wallets')}\n${wallets.map(walletLine).join(' · ')}`
            : t('details.noAccount'),
          t('details.pricing'),
        ].join('\n\n');

        return h(
          'span',
          { className: 'ccost-anchor', style: { order: 5 }, 'data-composer-stat': 'cost' },
          h('span', { className: 'ccost-pill', title, role: 'status' }, ICON, joined(parts)),
        );
      });

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          { name: 'conversation.composer.dock', id: 'cost', order: 2 },
          CostPill,
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
    };

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account'],
      apply,
    };
  },
});
