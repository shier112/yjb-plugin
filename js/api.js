/**
 * 养基宝 API 通信层
 * 基于 fetch API，兼容 MV3 Service Worker 和 Popup 环境
 */
var YjbAPI = (function () {
  var BASE_URL = 'http://browser-plug-api.yangjibao.com';
  var FALLBACK_URL = 'https://browser-plug-api.yangjibao.com';
  var SECRET = 'YxmKSrQR4uoJ5lOoWIhcbd7SlUEh9OOc';
  var TIMEOUT_MS = 30000;

  // ========== MD5 签名（js-md5 纯 JS 实现） ==========

  /**
   * 使用 js-md5 计算 MD5（纯 JS 实现，兼容 MV3 全环境）
   * js-md5 在浏览器/Service Worker 中自动走纯 JS 路径，不依赖 Node crypto
   * @param {string} str - 待签名字符串
   * @returns {string} 32位小写 hex
   */
  function md5_utf8(str) {
    return md5(str);
  }

  /**
   * 获取存储的 token（Promise）
   */
  function getToken() {
    return new Promise(function (resolve) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('token', function (result) {
          resolve(result.token || '');
        });
      } else {
        resolve('');
      }
    });
  }

  /**
   * 设置 token 到 storage
   */
  function setToken(token) {
    return new Promise(function (resolve) {
      chrome.storage.local.set({ token: token }, function () { resolve(); });
    });
  }

  /**
   * 获取当前时间戳（秒）
   */
  function getTimestamp() {
    return Math.floor(Date.now() / 1000).toString();
  }

  /**
   * 计算请求签名
   * 原始算法: MD5(baseURL_pathname + endpoint路径 + token + timestamp(秒) + secret)
   * baseURL无path时pathname为空串，即: MD5(endpoint + token + timestamp + SECRET)
   */
  function getSign(timestamp, token, endpoint) {
    var basePath = ''; // http://browser-plug-api.yangjibao.com 的 pathname 为空
    var pathOnly = endpoint.indexOf('?') !== -1 ? endpoint.split('?')[0] : endpoint;
    return md5_utf8(basePath + pathOnly + (token || '') + timestamp + SECRET);
  }

  /**
   * 带超时的 fetch 封装
   */
  function fetchWithTimeout(url, options, timeout) {
    timeout = timeout || TIMEOUT_MS;
    return Promise.race([
      fetch(url, options),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('请求超时')); }, timeout);
      })
    ]);
  }

  // ========== 核心 HTTP 方法 ==========

  /**
   * 发送请求到 API
   * @param {string} endpoint - API 端点路径
   * @param {Object} options - 请求选项
   * @param {boolean} options.method - GET/POST/DELETE
   * @param {Object} options.data - POST 请求体
   * @param {boolean} options.needAuth - 是否需要认证（默认 true）
   * @param {boolean} options.useFallback - 是否使用 fallback URL
   */
  function request(endpoint, options) {
    options = options || {};
    var method = (options.method || 'GET').toUpperCase();
    var needAuth = options.needAuth !== false;
    var useFallback = options.useFallback || false;
    var baseUrl = useFallback ? FALLBACK_URL : BASE_URL;

    return getToken().then(function (token) {
      var timestamp = getTimestamp();
      var headers = {
        'Content-Type': 'application/json',
        'Request-Time': timestamp,
        'Authorization': token || ''
      };

      if (needAuth) {
        headers['Request-Sign'] = getSign(timestamp, token, endpoint);
      }
      return doFetch(headers);

      function doFetch(hdrs) {
        var fetchOptions = {
          method: method,
          headers: hdrs,
          credentials: 'include'
        };

        if (options.data && (method === 'POST' || method === 'PUT')) {
          fetchOptions.body = JSON.stringify(options.data);
        }

        var fullUrl = baseUrl + endpoint;

        return fetchWithTimeout(fullUrl, fetchOptions)
          .then(function (response) {
            if (!response.ok) {
              return response.text().then(function (text) {
                throw new Error('HTTP ' + response.status + ': ' + (text || response.statusText));
              });
            }
            return response.json();
          })
          .then(function (json) {
            if (json && json.code !== undefined && json.code !== 0 && json.code !== 200) {
              throw new Error(json.message || json.msg || ('API 错误码: ' + json.code));
            }
            return json;
          });
      }
    });
  }

  // ========== 公开的 API 方法 ==========

  return {
    /** 版本信息 */
    versionInfo: function () {
      return request('/version_info?version=1.2.1', { needAuth: false });
    },

    /** 首页数据（资产、收益、账户列表） */
    indexData: function () {
      return request('/index_data');
    },

    /** 获取登录二维码 */
    qrCode: function () {
      return request('/qr_code');
    },

    /** 查询二维码扫描状态 */
    qrCodeState: function (eventId) {
      return request('/qr_code_state/' + eventId);
    },

    /** 账户数据收集 */
    accountCollect: function () {
      return request('/account_collect');
    },

    /** 收益曲线数据 */
    incomeLineData: function (params) {
      var parts = [];
      Object.keys(params).forEach(function (k) {
        var value = params[k];
        if (Array.isArray(value)) {
          value.forEach(function (item) {
            parts.push(k + '=' + encodeURIComponent(item));
          });
        } else {
          parts.push(k + '=' + encodeURIComponent(value));
        }
      });
      var qs = parts.join('&');
      return request('/income_line_data?' + qs);
    },

    /** 用户账户信息 */
    userAccount: function () {
      return request('/user_account');
    },

    /** 基金持仓列表 */
    fundHold: function () {
      return request('/fund_hold');
    },

    /** 收益详情数据 */
    incomeData: function (params) {
      var qs = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
      return request('/income_data?' + qs);
    },

    /** 搜索基金 */
    searchFund: function (keyword) {
      return request('/search_fund?keyword=' + encodeURIComponent(keyword));
    },

    /** 系统公告 */
    notice: function () {
      return request('/notice', { needAuth: false });
    },

    /** 添加基金持仓 */
    addFundHold: function (data) {
      return request('/fund_hold', { method: 'POST', data: data });
    },

    /** 删除基金持仓 */
    deleteFundHold: function (data) {
      return request('/remove_fund_hold', { method: 'DELETE', data: data });  // 原始用 DELETE
    },

    /** 设置/获取 token */
    token: {
      get: getToken,
      set: setToken
    },

    /** 暴露内部方法供高级用法 */
    _request: request,
    _md5: md5_utf8
  };
})();
