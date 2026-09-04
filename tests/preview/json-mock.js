/**
 * テンプレートの受け渡し画面（json.html）用のモック。
 *
 * スプレッドシートのダイアログはサンドボックス化された iframe で動くため、
 * window.confirm / alert / prompt は無視される。呼んだら分かるように差し替えておく。
 */
window.MOCK_CALLS = [];
window.NATIVE_DIALOGS = [];

['confirm', 'alert', 'prompt'].forEach(function (name) {
  window[name] = function (msg) {
    window.NATIVE_DIALOGS.push(name + ': ' + msg);
    return undefined;   // サンドボックス内で無視されたときと同じ戻り値
  };
});

window.google = {
  script: {
    host: { close: function () { window.MOCK_CALLS.push({ fn: 'close' }); } }
  }
};

Object.defineProperty(window.google.script, 'run', {
  get: function () {
    var handlers = {};
    var api = {
      withSuccessHandler: function (f) { handlers.ok = f; return api; },
      withFailureHandler: function (f) { handlers.ng = f; return api; },
      logClientError: function (where, message) {
        window.MOCK_CALLS.push({ fn: 'logClientError', where: where, message: message });
      },
      importTemplatesJson: function (json, mode) {
        window.MOCK_CALLS.push({ fn: 'importTemplatesJson', mode: mode, length: (json || '').length });
        setTimeout(function () {
          if (window.MOCK_FAIL) handlers.ng(new Error(window.MOCK_FAIL));
          else handlers.ok({ rows: 42, errors: [] });
        }, 20);
      }
    };
    return api;
  }
});
