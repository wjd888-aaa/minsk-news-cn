(function () {
  var PUB_KEY = 'pk_live_Y2xlcmsubmV3cy5taW5za3RjLm1lJA';
  var FAPI = 'https://clerk.news.minsktc.me';
  var SDK_URL = FAPI + '/npm/@clerk/clerk-js@5/dist/clerk.browser.js';

  var APPEARANCE = {
    variables: {
      colorPrimary: '#b33a2e',
      colorBackground: '#ffffff',
      colorText: '#333333',
      colorInputBackground: '#ffffff',
      borderRadius: '0.5rem',
      fontSize: '15px'
    },
    elements: {
      rootBox: { width: '100%', margin: '0 auto' },
      card: { boxShadow: 'none', border: 'none' }
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

  var loading = null;
  function getClerk() {
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        loadSdk(function (err, Clerk) {
          if (err) return reject(err);
          Clerk.load().then(function () { resolve(Clerk); }).catch(reject);
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
    '.bk-gate-card{position:relative;width:100%;max-width:400px;max-height:92vh;overflow-y:auto;background:#fff;' +
    'border-radius:14px;padding:26px 22px 20px;box-shadow:0 12px 48px rgba(0,0,0,.28);text-align:center}' +
    '.bk-gate-logo{font-size:34px;line-height:1}' +
    '.bk-gate-title{margin:10px 0 2px;font-size:19px;color:#222}' +
    '.bk-gate-sub{margin:0 0 14px;font-size:13px;color:#888}' +
    '.bk-gate-load{color:#999;font-size:14px;padding:18px 0}' +
    '.bk-gate-msg{min-height:18px;font-size:13px;color:#c0392b;margin:8px 0 0;word-break:break-all}' +
    '.bk-gate-retry{margin-top:6px;padding:9px 22px;border:none;border-radius:8px;background:#b33a2e;color:#fff;font-size:14px;cursor:pointer}';

  var LOCK_CSS =
    '.bk-locked{position:relative !important}' +
    '.bk-locked::before{content:\'\';position:absolute;left:-2px;top:-2px;right:-2px;bottom:-2px;z-index:4;' +
    '-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);background:rgba(250,250,250,.22);border-radius:inherit}' +
    '.bk-locked::after{content:\'🔒 注册 / 登录后查看\';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'z-index:5;background:#b33a2e;color:#fff;font-size:13px;line-height:1;padding:9px 16px;border-radius:999px;' +
    'box-shadow:0 4px 14px rgba(0,0,0,.28);white-space:nowrap;pointer-events:none;font-family:inherit}' +
    '.bk-locked a,.bk-locked button{pointer-events:none}';

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
          '<div class="bk-gate-logo">🌏</div>' +
          '<h2 class="bk-gate-title">白俄新闻中文站</h2>' +
          '<p class="bk-gate-sub">免费注册 / 登录，查看全部内容</p>' +
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
      var els = Array.prototype.slice.call(document.querySelectorAll('[data-lock]'));
      var pageLock = !!window.BK_LOCK_PAGE;
      var pageMain = pageLock ? (document.querySelector('main') || document.body) : null;
      if (!els.length && !pageLock) return Promise.resolve(false);

      try {
        var st = document.createElement('style');
        st.textContent = LOCK_CSS;
        document.head.appendChild(st);
      } catch (e) {}

      function applyLock() {
        els.forEach(function (el) { el.classList.add('bk-locked'); });
        if (pageMain) pageMain.classList.add('bk-locked');
      }

      function unlockAll() {
        els.forEach(function (el) { el.classList.remove('bk-locked'); });
        if (pageMain) pageMain.classList.remove('bk-locked');
      }

      applyLock();

      BKAuth.onAuth(function () { unlockAll(); });

      document.addEventListener('click', function (ev) {
        var t = ev.target && ev.target.closest ? ev.target.closest('.bk-locked') : null;
        if (!t) return;
        ev.preventDefault();
        ev.stopPropagation();
        window.BKAuth.gate();
      }, true);

      return BKAuth.user().then(function (u) {
        if (u) { unlockAll(); return true; }
        if (pageLock) window.BKAuth.gate();
        return false;
      }).catch(function () { return false; });
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

      function render(u) {
        var avatar = wrap.querySelector('#bkPfAvatar');
        var nameEl = wrap.querySelector('#bkPfName');
        var emailEl = wrap.querySelector('#bkPfEmail');
        btnArea.innerHTML = '';
        if (u) {
          var email = userEmailOf(u);
          var name = u.username || u.firstName || (email ? email.split('@')[0] : '用户');
          avatar.textContent = (name || '?').charAt(0).toUpperCase();
          nameEl.textContent = name;
          emailEl.textContent = email || '';
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
