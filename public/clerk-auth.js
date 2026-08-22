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

    isConfigured: function () { return PUB_KEY.indexOf('pk_') === 0; }
  };
})();
