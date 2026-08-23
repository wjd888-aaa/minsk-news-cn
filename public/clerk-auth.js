(function () {
  var PUB_KEY = 'pk_live_Y2xlcmsubmV3cy5taW5za3RjLm1lJA';
  var FAPI = 'https://clerk.news.minsktc.me';
  var SDK_URL = FAPI + '/npm/@clerk/clerk-js@5/dist/clerk.browser.js';

  var APPEARANCE = {
    logoImageUrl: '/icon-512.png',
    variables: {
      colorPrimary: '#b33a2e',
      colorBackground: '#ffffff',
      colorText: '#333333',
      colorInputBackground: '#ffffff',
      borderRadius: '0.625rem',
      fontSize: '15px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    },
    layout: {
      logoPlacement: 'top',
      showOptionalFields: false
    },
    elements: {
      rootBox: { width: '100%', margin: '0 auto' },
      card: { boxShadow: 'none', border: 'none', padding: '4px 0 0' },
      headerTitle: { fontSize: '19px', fontWeight: '600', color: '#222', marginBottom: '4px' },
      headerSubtitle: { fontSize: '13px', color: '#999', marginBottom: '18px' },
      logoImage: { width: '44px', height: '44px', margin: '0 auto 10px' },
      dividerLine: { background: '#f0ede8' },
      dividerText: { fontSize: '12px', color: '#bbb' },
      formFieldLabel: { fontSize: '13px', color: '#555' },
      formFieldInput: { borderRadius: '9px', borderColor: '#e5e0da' },
      formButtonPrimary: { borderRadius: '9px', fontSize: '15px', fontWeight: '600', padding: '11px 0' },
      socialButtonsBlockButton: { borderRadius: '9px', borderColor: '#e5e0da', fontSize: '14px' },
      footerActionLink: { color: '#b33a2e', fontSize: '14px' },
      identityPreviewText: { fontSize: '14px' }
    }
  };

  function loadSdk(cb) {
    if (window.Clerk) return cb(null, window.Clerk);
    var s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.setAttribute('data-clerk-publishable-key', PUB_KEY);
    s.onload = function () { cb(null, window.Clerk); };
    s.onerror = function () { cb(new Error('Clerk SDK 加载失败，请检查网络')); };
    document.head.appendChild(s);
  }

  var LOCALIZATION = {
    signIn: {
      start: { title: '欢迎回来', subtitle: '登录后解锁全部内容', actionText: '还没有账户？', actionLink: '注册' },
      emailCode: { title: '查收验证码', subtitle: '我们已将验证码发送到你的邮箱' }
    },
    signUp: {
      start: { title: '创建账户', subtitle: '注册即解锁全部内容', actionText: '已有账户？', actionLink: '登录' },
      emailCode: { title: '查收验证码', subtitle: '我们已将验证码发送到你的邮箱' }
    },
    'formButtonPrimary': '继续',
    'dividerText': '或',
    'formFieldLabel__emailAddress': '邮箱地址',
    'formFieldLabel__password': '密码',
    'formFieldInputPlaceholder__emailAddress': '请输入邮箱地址',
    'formFieldInputPlaceholder__password': '请输入密码'
  };

  var loading = null;
  function getClerk() {
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        loadSdk(function (err, Clerk) {
          if (err) return reject(err);
          Clerk.load({ localization: LOCALIZATION }).then(function () { resolve(Clerk); }).catch(reject);
        });
      });
    }
    return loading;
  }

  var mountedKind = null;

  var _authCbs = [];

  var GATE_CSS =
    '#bkGate{position:fixed;left:0;top:0;right:0;bottom:0;z-index:99998;display:-webkit-flex;display:flex;' +
    '-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;padding:18px;font-family:inherit}' +
    '.bk-gate-mask{position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(24,24,30,.58)}' +
    '.bk-gate-card{position:relative;width:100%;max-width:380px;max-height:92vh;overflow-y:auto;overflow-x:hidden;background:#fff;' +
    'border-radius:16px;padding:24px 22px 18px;box-shadow:0 12px 48px rgba(0,0,0,.28);text-align:center;-webkit-overflow-scrolling:touch}' +
    '.bk-gate-box{width:100%;max-width:100%}' +
    '.bk-gate-box iframe,.bk-gate-box .cl-rootBox,.bk-gate-box .cl-card{max-width:100%!important}' +
    '.bk-gate-load{color:#999;font-size:14px;padding:18px 0}' +
    '.bk-gate-msg{min-height:18px;font-size:13px;color:#c0392b;margin:8px 0 0;word-break:break-all}' +
    '.bk-gate-retry{margin-top:6px;padding:9px 22px;border:none;border-radius:8px;background:#b33a2e;color:#fff;font-size:14px;cursor:pointer}';

  var LOCK_CSS =
    '.bk-hidden{display:none !important}' +
    '.bk-banner{margin:14px 0;padding:14px 16px;background:#fff;border:1px dashed #e5b5b0;border-radius:12px;text-align:center}' +
    '.bk-banner b{color:#b33a2e;font-size:14px;font-weight:600;display:block;margin-bottom:9px}' +
    '.bk-banner button{padding:9px 24px;border:none;border-radius:999px;background:#b33a2e;color:#fff;' +
    'font-size:14px;cursor:pointer;font-family:inherit;-webkit-appearance:none;appearance:none}' +
    '.bk-cover-wrap{position:relative !important}' +
    '.bk-cover{position:absolute;left:0;top:0;right:0;bottom:0;z-index:9;background:#fdfcfb;border-radius:12px;' +
    'display:-webkit-flex;display:flex;-webkit-flex-direction:column;flex-direction:column;-webkit-align-items:center;align-items:center;' +
    '-webkit-justify-content:center;justify-content:center;gap:12px;padding:30px 18px;text-align:center}' +
    '.bk-cover .ico{font-size:34px;line-height:1}' +
    '.bk-cover p{margin:0;color:#666;font-size:14px}' +
    '.bk-cover button{padding:10px 28px;border:none;border-radius:999px;background:#b33a2e;color:#fff;font-size:15px;cursor:pointer;font-family:inherit}';

  var PANEL_CSS =
    '#bkPanelWrap{position:fixed;left:0;top:0;right:0;bottom:0;z-index:99997;display:-webkit-flex;display:flex;' +
    '-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;padding:18px;font-family:inherit}' +
    '.bk-panel-mask{position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(24,24,30,.45)}' +
    '.bk-panel{position:relative;width:100%;max-width:330px;background:#fff;border-radius:16px;padding:24px 20px 14px;' +
    'box-shadow:0 12px 48px rgba(0,0,0,.25);text-align:center}' +
    '.bk-pf-avatar{width:56px;height:56px;border-radius:50%;background:#b33a2e;color:#fff;font-size:26px;line-height:56px;' +
    'margin:0 auto 10px;font-weight:600}' +
    '.bk-pf-name{font-size:17px;color:#222;margin:0 0 3px;font-weight:600}' +
    '.bk-pf-email{font-size:13px;color:#999;margin:0 0 16px;word-break:break-all}' +
    '.bk-pf-btn{display:block;width:100%;padding:12px 0;border:none;border-radius:10px;background:#b33a2e;color:#fff;' +
    'font-size:15px;cursor:pointer;margin-bottom:8px;-webkit-appearance:none;appearance:none;font-family:inherit}' +
    '.bk-pf-btn.outline{background:#f7f5f1;color:#c0392b}' +
    '.bk-pf-links{border-top:1px solid #f0ede8;margin-top:14px;padding-top:4px;text-align:left}' +
    '.bk-pf-link{display:flex;justify-content:space-between;align-items:center;padding:11px 2px;color:#444;' +
    'text-decoration:none;font-size:14px;border-bottom:1px solid #f7f5f1}' +
    '.bk-pf-link:last-child{border-bottom:none}' +
    '.bk-pf-link b{font-weight:400;color:#888;font-size:12px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.bk-pf-foot{font-size:11px;color:#c0bdb8;margin-top:12px}';

  function userEmailOf(u) {
    try {
      if (u.primaryEmailAddress && typeof u.primaryEmailAddress === 'object') return u.primaryEmailAddress.emailAddress || '';
      if (u.emailAddresses && u.emailAddresses.length) {
        for (var i = 0; i < u.emailAddresses.length; i++) {
          if (u.primaryEmailAddressId === u.emailAddresses[i].id) return u.emailAddresses[i].emailAddress;
        }
        return u.emailAddresses[0].emailAddress;
      }
    } catch (e) {}
    return '';
  }

  function switchMount(kind, el) {
    return getClerk().then(function (Clerk) {
      if (mountedKind === 'signIn') { try { Clerk.unmountSignIn(el); } catch (e) {} }
      else if (mountedKind === 'signUp') { try { Clerk.unmountSignUp(el); } catch (e) {} }
      el.innerHTML = '';
      if (kind === 'signIn') Clerk.mountSignIn(el, { appearance: APPEARANCE });
      else Clerk.mountSignUp(el, { appearance: APPEARANCE });
      mountedKind = kind;
    });
  }

  window.BKAuth = {
    init: getClerk,

    user: function () {
      return getClerk().then(function (Clerk) { return Clerk.user || null; });
    },

    mountSignIn: function (el) {
      return switchMount('signIn', el);
    },

    mountSignUp: function (el) {
      return switchMount('signUp', el);
    },

    logout: function () {
      return getClerk().then(function (Clerk) { return Clerk.signOut(); });
    },

    isConfigured: function () { return PUB_KEY.indexOf('pk_') === 0; },

    onAuth: function (cb) {
      if (typeof cb === 'function') _authCbs.push(cb);
    },

    gate: function () {
      if (document.getElementById('bkGate')) return;

      try {
        var st = document.createElement('style');
        st.textContent = GATE_CSS;
        document.head.appendChild(st);
      } catch (e) {}

      var ov = document.createElement('div');
      ov.id = 'bkGate';
      ov.innerHTML =
        '<div class="bk-gate-mask"></div>' +
        '<div class="bk-gate-card" role="dialog" aria-modal="true">' +
          '<div class="bk-gate-load">正在加载登录服务…</div>' +
          '<div class="bk-gate-box"></div>' +
          '<div class="bk-gate-msg"></div>' +
          '<button type="button" class="bk-gate-retry" hidden>重新加载</button>' +
        '</div>';
      document.body.appendChild(ov);

      var box = ov.querySelector('.bk-gate-box');
      var loadEl = ov.querySelector('.bk-gate-load');
      var msgEl = ov.querySelector('.bk-gate-msg');
      var retryBtn = ov.querySelector('.bk-gate-retry');
      var cur = '';
      var stopped = false;

      function userEmail(u) {
        try {
          if (u.primaryEmailAddress && typeof u.primaryEmailAddress === 'object') return u.primaryEmailAddress.emailAddress || '';
          if (u.emailAddresses && u.emailAddresses.length) {
            for (var i = 0; i < u.emailAddresses.length; i++) {
              if (u.primaryEmailAddressId === u.emailAddresses[i].id) return u.emailAddresses[i].emailAddress;
            }
            return u.emailAddresses[0].emailAddress;
          }
        } catch (e) {}
        return '';
      }

      function rememberUser(u) {
        try {
          var email = userEmail(u);
          var name = u.username || u.firstName || (email ? email.split('@')[0] : '用户');
          localStorage.setItem('bk_user', JSON.stringify({ n: name, e: email }));
        } catch (e) {}
      }

      function refreshTopbar() {
        var link = document.getElementById('bkUserLink');
        if (!link) return;
        try {
          var info = JSON.parse(localStorage.getItem('bk_user') || 'null');
          if (info && info.n) link.textContent = '👤 ' + (info.n.length > 10 ? info.n.slice(0, 10) + '…' : info.n);
        } catch (e) {}
      }

      function unmountCur(Clerk) {
        if (!cur) return;
        try { if (cur === 'signIn') Clerk.unmountSignIn(box); else Clerk.unmountSignUp(box); } catch (e) {}
        cur = '';
      }

      function mount(kind) {
        return getClerk().then(function (Clerk) {
          unmountCur(Clerk);
          box.innerHTML = '';
          if (kind === 'signIn') Clerk.mountSignIn(box, { appearance: APPEARANCE });
          else Clerk.mountSignUp(box, { appearance: APPEARANCE });
          cur = kind;
        });
      }

      function fireAuth(u) {
        for (var i = 0; i < _authCbs.length; i++) {
          try { _authCbs[i](u); } catch (e) {}
        }
      }

      function accept(u) {
        rememberUser(u);
        refreshTopbar();
        stopped = true;
        try { if (window.Clerk) unmountCur(window.Clerk); } catch (e) {}
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        fireAuth(u);
      }

      function showErr(e) {
        loadEl.style.display = 'none';
        box.innerHTML = '';
        msgEl.textContent = '登录服务加载失败：' + ((e && e.message) || '网络错误');
        retryBtn.hidden = false;
      }

      ov.addEventListener('click', function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest('.cl-footerActionLink') : null;
        if (!a) return;
        var href = a.getAttribute('href') || '';
        ev.preventDefault();
        if (/sign-up/i.test(href)) mount('signUp').catch(showErr);
        else if (/sign-in/i.test(href)) mount('signIn').catch(showErr);
      });

      retryBtn.addEventListener('click', function () {
        msgEl.textContent = '';
        retryBtn.hidden = true;
        loadEl.style.display = '';
        start();
      });

      function watch(Clerk) {
        try {
          Clerk.addListener(function (e) {
            if (stopped) return;
            var s = e.client && e.client.sessions && e.client.sessions[0];
            if (s && s.user) accept(s.user);
          });
        } catch (e) {}
        var tries = 0;
        var timer = setInterval(function () {
          if (stopped) { clearInterval(timer); return; }
          tries++;
          if (Clerk.user) accept(Clerk.user);
          if (tries > 600) clearInterval(timer);
        }, 1000);
      }

      function start() {
        getClerk().then(function (Clerk) {
          if (stopped) return;
          if (Clerk.user) { accept(Clerk.user); return; }
          loadEl.style.display = 'none';
          watch(Clerk);
          mount('signIn').catch(showErr);
        }).catch(showErr);
      }

      start();
    },

    locks: function () {
      function start() {
        var els = Array.prototype.slice.call(document.querySelectorAll('[data-lock]'));
        var pageLock = !!window.BK_LOCK_PAGE;
        if (!els.length && !pageLock) return;

        try {
          var st = document.createElement('style');
          st.textContent = LOCK_CSS;
          document.head.appendChild(st);
        } catch (e) {}

        var nDeal = 0, nFf = 0, nList = 0;
        els.forEach(function (el) {
          el.classList.add('bk-hidden');
          if (el.classList.contains('ff-deal')) nFf++;
          else if (el.classList.contains('deal')) nDeal++;
          else nList++;
        });

        function makeBanner(n) {
          var d = document.createElement('div');
          d.className = 'bk-banner';
          var b = document.createElement('b');
          b.textContent = '🔒 还有 ' + n + ' 条内容，登录后即可查看';
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = '注册 / 登录';
          btn.addEventListener('click', function () { window.BKAuth.gate(); });
          d.appendChild(b);
          d.appendChild(btn);
          return d;
        }

        function addBanner(container, n, atEnd) {
          if (!container || !n) return;
          if (atEnd) container.appendChild(makeBanner(n));
          else container.parentNode.insertBefore(makeBanner(n), container.nextSibling);
        }

        var dealFeed = document.querySelector('.deal-feed:not(.ff-feed)');
        addBanner(dealFeed, nDeal, true);

        var ffFeed = document.querySelector('.ff-feed');
        addBanner(ffFeed, nFf, true);

        if (nList > 0) {
          var lifeMain = document.querySelector('.life-list') ? document.querySelector('main') : null;
          if (lifeMain) {
            addBanner(lifeMain, nList, true);
          } else {
            var tabs = document.querySelector('.tabs');
            if (tabs) addBanner(tabs, nList, false);
          }
        }

        if (pageLock) {
          var m = document.querySelector('main');
          if (m) {
            m.classList.add('bk-cover-wrap');
            var cov = document.createElement('div');
            cov.className = 'bk-cover';
            cov.innerHTML = '<div class="ico">🔒</div><p>这篇文章需要注册 / 登录后才能阅读全文</p>';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = '注册 / 登录';
            btn.addEventListener('click', function () { window.BKAuth.gate(); });
            cov.appendChild(btn);
            m.appendChild(cov);
          }
        }

        function unlockAll() {
          els.forEach(function (el) { el.classList.remove('bk-hidden'); });
          Array.prototype.slice.call(document.querySelectorAll('.bk-banner')).forEach(function (b) { b.parentNode.removeChild(b); });
          var cov = document.querySelector('.bk-cover');
          if (cov) cov.parentNode.removeChild(cov);
          var m2 = pageLock ? document.querySelector('main') : null;
          if (m2) m2.classList.remove('bk-cover-wrap');
        }

        BKAuth.onAuth(function () { unlockAll(); });

        return BKAuth.user().then(function (u) {
          if (u) unlockAll();
          else if (pageLock) window.BKAuth.gate();
        }).catch(function () {
          if (pageLock) window.BKAuth.gate();
        });
      }

      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
    },

    panel: function () {
      if (document.getElementById('bkPanelWrap')) return;

      try {
        var st = document.createElement('style');
        st.textContent = PANEL_CSS;
        document.head.appendChild(st);
      } catch (e) {}

      var wrap = document.createElement('div');
      wrap.id = 'bkPanelWrap';
      wrap.innerHTML =
        '<div class="bk-panel-mask"></div>' +
        '<div class="bk-panel" role="dialog" aria-modal="true">' +
          '<div class="bk-pf-avatar" id="bkPfAvatar">?</div>' +
          '<p class="bk-pf-name" id="bkPfName">未登录</p>' +
          '<p class="bk-pf-email" id="bkPfEmail">登录后可查看全部内容</p>' +
          '<div id="bkPfBtnArea"></div>' +
          '<div class="bk-pf-links">' +
            '<a class="bk-pf-link" href="mailto:business@minsktc.me"><span>💼 业务合作</span><b>business@minsktc.me</b></a>' +
            '<a class="bk-pf-link" href="mailto:tech@minsktc.me"><span>🛠 技术维护</span><b>tech@minsktc.me</b></a>' +
            '<a class="bk-pf-link" href="/privacy.html"><span>📄 隐私政策</span><span class="arr">›</span></a>' +
            '<a class="bk-pf-link" href="/terms.html"><span>📜 用户协议</span><span class="arr">›</span></a>' +
          '</div>' +
          '<p class="bk-pf-foot">©2026 MwM · 白俄新闻中文站</p>' +
        '</div>';
      document.body.appendChild(wrap);

      var btnArea = wrap.querySelector('#bkPfBtnArea');

      function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
      function stop(e) { if (e.target === this) close(); }

      function toState(u) {
        if (!u) return null;
        if (u._local) return { name: u.username || '用户', email: u.email || '' };
        var email = userEmailOf(u);
        var name = u.username || u.firstName || (email ? email.split('@')[0] : '用户');
        return { name: name, email: email };
      }

      function localState() {
        try {
          var info = JSON.parse(localStorage.getItem('bk_user') || 'null');
          if (info && info.n) return { _local: true, username: info.n, email: info.e || '' };
        } catch (e) {}
        return null;
      }

      function render(u) {
        var s = typeof u !== 'undefined' && arguments.length ? toState(u) : localState();
        var avatar = wrap.querySelector('#bkPfAvatar');
        var nameEl = wrap.querySelector('#bkPfName');
        var emailEl = wrap.querySelector('#bkPfEmail');
        btnArea.innerHTML = '';
        if (s) {
          avatar.textContent = (s.name || '?').charAt(0).toUpperCase();
          nameEl.textContent = s.name;
          emailEl.textContent = s.email;
          var out = document.createElement('button');
          out.type = 'button';
          out.className = 'bk-pf-btn outline';
          out.textContent = '退出登录';
          out.addEventListener('click', function () {
            try { localStorage.removeItem('bk_user'); } catch (e) {}
            BKAuth.logout().then(function () { location.reload(); });
          });
          btnArea.appendChild(out);
        } else {
          avatar.textContent = '👤';
          nameEl.textContent = '未登录';
          emailEl.textContent = '登录后可查看全部内容';
          var inn = document.createElement('button');
          inn.type = 'button';
          inn.className = 'bk-pf-btn';
          inn.textContent = '登录 / 注册';
          inn.addEventListener('click', function () {
            close();
            window.BKAuth.gate();
          });
          btnArea.appendChild(inn);
        }
      }

      wrap.querySelector('.bk-panel-mask').addEventListener('click', stop);
      BKAuth.onAuth(function (u) { render(u); });
      render();
      BKAuth.user().then(render).catch(function () {});
    }
  };

  function bindUserLink() {
    var link = document.getElementById('bkUserLink');
    if (!link || link.getAttribute('data-bk-panel')) return;
    link.setAttribute('data-bk-panel', '1');
    link.style.cursor = 'pointer';
    link.addEventListener('click', function (ev) {
      ev.preventDefault();
      window.BKAuth.panel();
    });
  }

  bindUserLink();
})();
