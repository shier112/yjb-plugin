/**
 * 养基宝 Popup 主逻辑 (MV3 重写版)
 * 纯 JavaScript 实现，无框架依赖
 */
(function () {
  'use strict';

  // =============================================
  // 全局状态
  // =============================================

  var state = {
    // 数据
    data: null,              // index_data 返回的完整数据
    accounts: [],            // 账户列表（从 data.account_data 提取）
    funds: [],               // 当前账户的基金列表
    indexData: {},           // 大盘指数
    accountLines: {},        // account_id -> income_line_data day line_list

    // UI 状态
    currentView: 'main',     // 当前视图: main / manage / add
    selectedAccountIdx: -1,   // 当前选中的账户索引（-1=全部/总览）
    selectedAccountKey: 'all',
    selectedAccountRestored: false,
    sortBy: 'income',        // 排序方式: income / rate / name
    sortOrder: 'desc',       // 排序方向: asc / desc
    expandedFund: null,      // 展开的基金代码
    summaryExpanded: false,  // 收益详情面板是否展开
    theme: 'classic',        // 样式主题: classic / obsidian / teal / crimson

    // 登录
    qrEventId: null,         // 二维码 event_id
    qrPollTimer: null,       // 二维码轮询定时器
    isLoggedIn: false,

    // Webhook
    webhookConfig: {
      enabled: false,
      url: '',
      interval: 5,
      timedEnabled: true,
      dailyEnabled: false,
      weeklyEnabled: false,
      monthlyEnabled: false
    },

    // 数据刷新
    refreshConfig: {
      enabled: true,
      interval: 3
    },
    refreshTimer: null,
    countdownTimer: null,
    nextRefreshAt: null,
    isRefreshing: false,

    // 配置
    showConfig: false,
    showWebhook: false,

    // 管理页搜索
    manageSearchKeyword: ''
  };

  // =============================================
  // DOM 引用缓存
  // =============================================
  var $ = function (sel) { return document.querySelector(sel); };

  var dom = {
    // 视图容器
    viewMain: $('#view_main'),
    viewManage: $('#view_manage'),
    viewAdd: $('#view_add'),

    // 标题栏
    btnBackMain: $('#btn_back_main'),
    btnSettings: $('#btn_settings'),
    btnRefreshNow: $('#btn_refresh_now'),
    refreshCountdown: $('#refresh_countdown'),

    // 大盘指数栏
    marketBar: $('#market_bar'),
    marketBarManage: $('#market_bar_manage'),

    // 账户标签
    accountTabs: $('#account_tabs'),
    accountTabsManage: $('#account_tabs_manage'),

    // 账户详情卡片（替代原 summary_card）
    accountCard: $('#account_card'),

    // 基金列表
    fundList: $('#fund_list'),

    // 底部操作栏（替代底部导航）
    bottomBar: $('#bottom_bar'),
    bottomBarManage: $('#bottom_bar_manage'),
    bottomAssets: $('#bottom_assets'),
    bottomAssetsMg: $('#bottom_assets_mg'),
    bottomUp: $('#bottom_up'),
    bottomUpMg: $('#bottom_up_mg'),
    bottomDown: $('#bottom_down'),
    bottomDownMg: $('#bottom_down_mg'),
    bottomIncome: $('#bottom_income'),
    bottomIncomeMg: $('#bottom_income_mg'),
    bottomExpand: $('#bottom_expand'),
    bottomExpandMg: $('#bottom_expand_mg'),
    detailExpandPanel: $('#detail_expand_panel'),
    detailExpandPanelMg: $('#detail_expand_panel_mg'),
    btnAddQuick: $('#btn_add_fund_quick'),
    btnAddQuickMg: $('#btn_add_fund_quick_mg'),

    // 管理
    btnBackFromManage: $('#btn_back_from_manage'),
    searchInput: $('#search_input'),
    manageList: $('#manage_list'),

    // 添加
    btnBackFromAdd: $('#btn_back_from_add'),
    addManualPanel: $('#add_manual_panel'),
    addQrcodePanel: $('#add_qrcode_panel'),
    addFundCode: $('#add_fund_code'),
    addFundName: $('#add_fund_name'),
    fundSearchResult: $('#fund_search_result'),
    btnAddFundConfirm: $('#btn_add_fund_confirm'),
    qrCodeImg: $('#qr_code_img'),
    qrStatusText: $('#qr_status_text'),

    // 配置面板
    panelConfig: $('#panel_config'),
    btnCloseConfig: $('#btn_close_config'),
    btnLogin: $('#btn_login'),
    userInfoSection: $('#user_info_section'),
    userName: $('#user_name'),
    userAvatar: $('#user_avatar'),
    btnOpenWebhook: $('#btn_open_webhook'),
    themeGrid: $('#theme_grid'),
    refreshToggle: $('#refresh_toggle'),
    refreshInterval: $('#refresh_interval'),
    periodTestResult: $('#period_test_result'),
    periodTestCopyBtn: $('#period_test_copy_btn'),

    // Webhook 面板
    panelWebhook: $('#panel_webhook'),
    btnCloseWebhook: $('#btn_close_webhook'),
    whToggle: $('#wh_toggle'),
    whFields: $('#wh_fields'),
    whUrl: $('#wh_url'),
    whInterval: $('#wh_interval'),
    whTimedToggle: $('#wh_timed_toggle'),
    whDailyToggle: $('#wh_daily_toggle'),
    whWeeklyToggle: $('#wh_weekly_toggle'),
    whMonthlyToggle: $('#wh_monthly_toggle'),
    whSaveBtn: $('#wh_save_btn'),
    whTestBtn: $('#wh_test_btn'),

    // 对话框
    dialogLogin: $('#dialog_login'),
    btnCloseLogin: $('#btn_close_login'),
    loginQrImg: $('#login_qr_img'),
    loginQrHint: $('#login_qr_hint'),
    btnRefreshQr: $('#btn_refresh_qr'),

    dialogVersion: $('#dialog_version'),
    currentVer: $('#current_ver'),
    latestVer: $('#latest_ver'),
    versionContent: $('#version_content'),
    btnSkipVersion: $('#btn_skip_version'),
    btnGoUpdate: $('#btn_go_update'),

    dialogConfirm: $('#dialog_confirm'),
    confirmMsg: $('#confirm_msg'),
    confirmCancel: $('#confirm_cancel'),
    confirmOk: $('#confirm_ok'),

    loadingMask: $('#loading_mask')
  };

  // =============================================
  // 工具函数
  // =============================================

  /**
   * 通用字段取值 — 兼容 snake_case / camelCase / 简写等多种命名
   * @param {Object} obj - 数据对象
   * @param {string[]} keys - 候选字段名列表，按优先级排列
   * @returns {*} 第一个存在的字段值
   */
  function pick(obj, keys) {
    if (!obj) return undefined;
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] !== undefined && obj[keys[i]] !== null) {
        return obj[keys[i]];
      }
    }
    return undefined;
  }

  function formatMoney(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    return Number(val).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatIncome(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    var num = Number(val);
    return (num >= 0 ? '+' : '') + num.toFixed(2);
  }

  function formatRate(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    var num = Number(val);
    return (num >= 0 ? '+' : '') + num.toFixed(2) + '%';
  }

  function getIncomeClass(val) {
    if (val === null || val === undefined || isNaN(val)) return '';
    return val >= 0 ? 'text-up' : 'text-down';
  }

  /**
   * 显示/隐藏加载状态
   */
  function showLoading(show) {
    dom.loadingMask.style.display = show ? 'flex' : 'none';
  }

  /**
   * 安全地设置 innerHTML
   */
  function setHTML(el, html) {
    if (el) el.innerHTML = html;
  }

  function formatCountdown(ms) {
    if (!ms || ms < 0) ms = 0;
    var total = Math.ceil(ms / 1000);
    var min = Math.floor(total / 60);
    var sec = total % 60;
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  function updateRefreshCountdown() {
    if (!dom.refreshCountdown) return;

    dom.refreshCountdown.classList.remove('is-paused', 'is-soon');
    if (!state.refreshConfig.enabled) {
      dom.refreshCountdown.textContent = '已关';
      dom.refreshCountdown.classList.add('is-paused');
      return;
    }

    if (!state.nextRefreshAt) {
      dom.refreshCountdown.textContent = '--:--';
      return;
    }

    var remain = state.nextRefreshAt - Date.now();
    dom.refreshCountdown.textContent = formatCountdown(remain);
    if (remain <= 10000) dom.refreshCountdown.classList.add('is-soon');
  }

  function clearRefreshTimers() {
    if (state.refreshTimer) {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
  }

  function scheduleNextRefresh() {
    clearRefreshTimers();

    if (!state.refreshConfig.enabled) {
      state.nextRefreshAt = null;
      updateRefreshCountdown();
      return;
    }

    var intervalMs = Math.max(1, state.refreshConfig.interval || 3) * 60 * 1000;
    state.nextRefreshAt = Date.now() + intervalMs;
    updateRefreshCountdown();

    state.countdownTimer = setInterval(updateRefreshCountdown, 1000);
    state.refreshTimer = setTimeout(function () {
      loadIndexData({ source: 'timer' });
    }, intervalMs);
  }

  function syncRefreshControls() {
    if (dom.refreshToggle) dom.refreshToggle.checked = !!state.refreshConfig.enabled;
    if (dom.refreshInterval) dom.refreshInterval.value = String(state.refreshConfig.interval || 3);
    updateRefreshCountdown();
  }

  function notifyRefreshAlarm() {
    try {
      chrome.runtime.sendMessage({
        type: 'UPDATE_REFRESH_ALARM',
        enabled: state.refreshConfig.enabled,
        interval: state.refreshConfig.interval
      }).catch(function () {});
    } catch (e) {}
  }

  function loadRefreshConfig(callback) {
    if (!window.chrome || !chrome.storage || !chrome.storage.local) {
      syncRefreshControls();
      scheduleNextRefresh();
      if (callback) callback();
      return;
    }
    chrome.storage.local.get(['refreshEnabled', 'refreshInterval'], function (result) {
      state.refreshConfig.enabled = result.refreshEnabled !== false;
      state.refreshConfig.interval = Math.max(1, parseInt(result.refreshInterval || '3', 10) || 3);
      syncRefreshControls();
      scheduleNextRefresh();
      if (callback) callback();
    });
  }

  function saveRefreshConfig() {
    state.refreshConfig.enabled = dom.refreshToggle ? dom.refreshToggle.checked : state.refreshConfig.enabled;
    state.refreshConfig.interval = Math.max(1, parseInt(dom.refreshInterval ? dom.refreshInterval.value : state.refreshConfig.interval, 10) || 3);

    if (!window.chrome || !chrome.storage || !chrome.storage.local) {
      syncRefreshControls();
      scheduleNextRefresh();
      return;
    }

    chrome.storage.local.set({
      refreshEnabled: state.refreshConfig.enabled,
      refreshInterval: state.refreshConfig.interval
    }, function () {
      syncRefreshControls();
      scheduleNextRefresh();
      notifyRefreshAlarm();
    });
  }

  function setRefreshButtonLoading(loading) {
    if (!dom.btnRefreshNow) return;
    dom.btnRefreshNow.disabled = !!loading;
    dom.btnRefreshNow.classList.toggle('yjb_refresh_spinning', !!loading);
  }

  var THEMES = ['classic', 'obsidian', 'teal', 'crimson'];

  function normalizeTheme(theme) {
    return THEMES.indexOf(theme) !== -1 ? theme : 'classic';
  }

  function syncThemeControls() {
    if (!dom.themeGrid) return;
    var buttons = dom.themeGrid.querySelectorAll('.yjb_theme_option');
    buttons.forEach(function (btn) {
      var active = btn.getAttribute('data-theme') === state.theme;
      btn.classList.toggle('yjb_theme_option_active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function applyTheme(theme, persist) {
    state.theme = normalizeTheme(theme);
    document.documentElement.setAttribute('data-theme', state.theme);
    syncThemeControls();

    if (persist !== false && window.chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ styleTheme: state.theme });
    }
  }

  function loadThemeConfig(callback) {
    if (!window.chrome || !chrome.storage || !chrome.storage.local) {
      applyTheme(state.theme, false);
      if (callback) callback();
      return;
    }

    chrome.storage.local.get(['styleTheme'], function (result) {
      applyTheme(result.styleTheme || 'classic', false);
      if (callback) callback();
    });
  }

  function renderUserProfile(name, avatarUrl, loggedIn) {
    var displayName = name || (loggedIn ? '已登录' : '未登录');
    if (dom.userName) dom.userName.textContent = displayName;
    if (dom.btnLogin) dom.btnLogin.textContent = loggedIn ? '退出登录' : '点击登录';

    if (!dom.userAvatar) return;
    if (avatarUrl && /^https?:\/\//.test(avatarUrl)) {
      dom.userAvatar.innerHTML = '<img src="' + escapeHtml(avatarUrl) + '" alt="" />';
    } else {
      dom.userAvatar.textContent = name ? (name + '').charAt(0) : '👤';
    }
  }

  function cacheUserProfile(name, avatarUrl) {
    if (!window.chrome || !chrome.storage || !chrome.storage.local) return;
    if (!name && !avatarUrl) return;
    chrome.storage.local.set({
      cachedUserName: name || '',
      cachedUserAvatar: avatarUrl || ''
    });
  }

  function clearCachedUserProfile() {
    if (!window.chrome || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.remove(['cachedUserName', 'cachedUserAvatar']);
  }

  function loadCachedUserProfile(callback) {
    if (!window.chrome || !chrome.storage || !chrome.storage.local) {
      if (callback) callback(false);
      return;
    }
    chrome.storage.local.get(['cachedUserName', 'cachedUserAvatar'], function (result) {
      var hasProfile = !!(result.cachedUserName || result.cachedUserAvatar);
      if (hasProfile) {
        state.isLoggedIn = true;
        renderUserProfile(result.cachedUserName, result.cachedUserAvatar, true);
      }
      if (callback) callback(hasProfile, result);
    });
  }

  function getAccountKey(acc, idx) {
    if (idx === -1) return 'all';
    var key = pick(acc, ['account_id', 'accountId', 'id', 'account_code', 'accountCode', 'code']);
    var title = pick(acc, ['title', 'name', 'account_name', 'accountName', 'platform']);
    if (key !== undefined && key !== null && key !== '') return 'id:' + key;
    if (title) return 'title:' + title;
    return 'idx:' + idx;
  }

  function applySelectedAccount(idx, persist) {
    if (idx !== -1 && (idx < 0 || idx >= state.accounts.length)) idx = state.accounts.length ? 0 : -1;
    state.selectedAccountIdx = idx;
    state.selectedAccountKey = idx === -1 ? 'all' : getAccountKey(state.accounts[idx], idx);

    if (persist !== false && window.chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        selectedAccountIdx: state.selectedAccountIdx,
        selectedAccountKey: state.selectedAccountKey
      });
    }
  }

  function restoreSelectedAccount(callback) {
    if (state.selectedAccountRestored) {
      if (callback) callback();
      return;
    }

    if (!window.chrome || !chrome.storage || !chrome.storage.local) {
      state.selectedAccountRestored = true;
      if (callback) callback();
      return;
    }

    chrome.storage.local.get(['selectedAccountIdx', 'selectedAccountKey'], function (result) {
      var savedIdx = parseInt(result.selectedAccountIdx, 10);
      var savedKey = result.selectedAccountKey || (savedIdx === -1 ? 'all' : '');
      if (savedKey === 'all' || savedIdx === -1) {
        applySelectedAccount(-1, false);
      } else {
        var restoredIdx = -1;
        if (savedKey) {
          for (var i = 0; i < state.accounts.length; i++) {
            if (getAccountKey(state.accounts[i], i) === savedKey) {
              restoredIdx = i;
              break;
            }
          }
        }
        if (restoredIdx === -1 && !isNaN(savedIdx) && savedIdx >= 0 && savedIdx < state.accounts.length) {
          restoredIdx = savedIdx;
        }
        applySelectedAccount(restoredIdx === -1 ? -1 : restoredIdx, false);
      }
      state.selectedAccountRestored = true;
      if (callback) callback();
    });
  }

  // =============================================
  // 视图路由
  // =============================================

  function switchView(viewName) {
    state.currentView = viewName;

    // 隐藏所有视图
    [dom.viewMain, dom.viewManage, dom.viewAdd].forEach(function (v) {
      if (v) v.classList.remove('yjb_view_active');
    });

    // 显示目标视图
    var target = null;
    switch (viewName) {
      case 'main': target = dom.viewMain; break;
      case 'manage': target = dom.viewManage; break;
      case 'add': target = dom.viewAdd; break;
    }
    if (target) target.classList.add('yjb_view_active');

    // 控制返回按钮显示
    if (dom.btnBackMain) dom.btnBackMain.style.display = viewName === 'main' ? 'none' : 'block';
  }

  function openSidePanel(panelId) {
    var panel = document.getElementById(panelId);
    if (panel) panel.classList.add('yjb_side_panel_open');
  }

  function closeSidePanel(panelId) {
    var panel = document.getElementById(panelId);
    if (panel) panel.classList.remove('yjb_side_panel_open');
  }

  function showDialog(dialogId) {
    var dlg = document.getElementById(dialogId);
    if (dlg) dlg.style.display = 'flex';
  }

  function hideDialog(dialogId) {
    var dlg = document.getElementById(dialogId);
    if (dlg) dlg.style.display = 'none';
  }

  // =============================================
  // 数据加载与渲染
  // =============================================

  function getAccountListFromPayload(payload) {
    var list = pick(payload, ['account_data', 'accountData', 'accounts', 'list', 'data', 'items']);
    return Array.isArray(list) ? list : null;
  }

  function looksLikeIndexItem(item) {
    return item && typeof item === 'object' &&
      (item.v !== undefined || item.dir !== undefined || item.show_code !== undefined ||
        (item.name !== undefined && (item.code !== undefined || item.show_code !== undefined)));
  }

  function looksLikeIndexMap(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    if (getAccountListFromPayload(payload)) return false;
    if (hasSummaryPayload(payload)) return false;

    var keys = Object.keys(payload);
    if (!keys.length) return false;

    var checked = 0;
    var matched = 0;
    for (var i = 0; i < keys.length && checked < 8; i++) {
      var item = payload[keys[i]];
      if (item && typeof item === 'object') {
        checked++;
        if (looksLikeIndexItem(item)) matched++;
      }
    }
    return checked > 0 && checked === matched;
  }

  function getIndexDataFromPayload(payload) {
    var indexData = pick(payload, ['index_data', 'indexData', 'index', 'market_data']);
    if (indexData && typeof indexData === 'object' && !Array.isArray(indexData)) return indexData;
    return looksLikeIndexMap(payload) ? payload : null;
  }

  function hasSummaryPayload(payload) {
    return pick(payload, [
      'assets_collect', 'assetsCollect', 'account_assets', 'accountAssets', 'total_assets', 'totalAssets',
      'today_income', 'todayIncome', 'today_income_rate', 'todayIncomeRate',
      'hold_income', 'holdIncome', 'hold_income_rate', 'holdIncomeRate'
    ]) !== undefined;
  }

  function getFundListFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    var list = pick(payload, ['fund_list', 'fundList', 'funds', 'hold_list', 'holdList', 'items']);
    return Array.isArray(list) ? list : null;
  }

  function attachStateFundsToAccounts(funds) {
    if (!Array.isArray(funds) || !state.accounts.length) return;

    if (!funds.length) {
      state.accounts.forEach(function (acc) {
        acc.fund_list = [];
      });
      return;
    }

    if (state.accounts.length === 1) {
      state.accounts[0].fund_list = funds;
      return;
    }

    state.accounts.forEach(function (acc) {
      var accId = pick(acc, ['account_id', 'accountId', 'id']);
      acc.fund_list = funds.filter(function (fund) {
        var fundAccId = pick(fund, ['account_id', 'accountId']);
        return accId !== undefined && fundAccId !== undefined && String(fundAccId) === String(accId);
      });
    });

    var assigned = [];
    state.accounts.forEach(function (acc) {
      assigned = assigned.concat(acc.fund_list || []);
    });
    var unassigned = funds.filter(function (fund) { return assigned.indexOf(fund) === -1; });
    if (unassigned.length && state.accounts[0]) {
      state.accounts[0].fund_list = (state.accounts[0].fund_list || []).concat(unassigned);
    }
  }

  function getAccountId(acc) {
    return pick(acc, ['account_id', 'accountId', 'id']);
  }

  function getAccountLineList(acc) {
    var accountId = getAccountId(acc);
    if (accountId === undefined || accountId === null) return [];
    return state.accountLines[String(accountId)] || [];
  }

  function refreshAccountLineData(callback) {
    var accounts = state.accounts || [];
    var accountIds = accounts.map(getAccountId).filter(function (accountId) {
      return accountId !== undefined && accountId !== null && String(accountId) !== '';
    });

    if (!accountIds.length) {
      state.accountLines = {};
      if (callback) callback();
      return;
    }

    YjbAPI.incomeLineData({
      'account_ids[]': accountIds,
      date_type: 'day'
    }).then(function (res) {
      var data = res && res.data;
      var nextLines = {};
      if (data && typeof data === 'object') {
        accountIds.forEach(function (accountId) {
          var row = data[String(accountId)];
          nextLines[String(accountId)] = row && Array.isArray(row.line_list) ? row.line_list : [];
        });
      }
      state.accountLines = nextLines;
      if (callback) callback();
    }).catch(function (err) {
      console.warn('[YJB] income_line_data day 失败:', err);
      state.accountLines = {};
      if (callback) callback();
    });
  }

  function renderDataViews() {
    renderMarketBar('market_bar');
    renderMarketBar('market_bar_manage');
    renderAccountCard();
    renderDetailPanel();
    renderAccountTabs('account_tabs');
    renderAccountTabs('account_tabs_manage');
    renderFundList();
    renderBottomBar('bottom_bar');
    if (state.currentView === 'manage') {
      renderManageList();
      renderBottomBar('bottom_bar_manage');
    }
  }

  function applyBackgroundDataUpdate(payload) {
    if (!payload || typeof payload !== 'object') return;

    var nextIndexData = getIndexDataFromPayload(payload);
    if (nextIndexData) state.indexData = nextIndexData;

    var nextFunds = getFundListFromPayload(payload);
    var nextAccounts = getAccountListFromPayload(payload);
    if (nextAccounts) {
      state.data = payload;
      state.accounts = nextAccounts;
    } else if (hasSummaryPayload(payload)) {
      state.data = Object.assign({}, state.data || {}, payload);
    }

    if (nextFunds) {
      state.funds = nextFunds;
      if (state.data) state.data.fund_list = state.funds;
      attachStateFundsToAccounts(state.funds);
    }
  }

  /**
   * 加载首页数据（多接口并行）
   * 原始代码流程: indexData(大盘指数) + accountCollect(账户汇总) + user_account(用户信息)
   */
  function loadIndexData(options) {
    options = options || {};
    if (state.isRefreshing) {
      if (options.source === 'timer') scheduleNextRefresh();
      return;
    }
    var silent = options.silent === true || options.source === 'timer';
    state.isRefreshing = true;
    clearRefreshTimers();
    setRefreshButtonLoading(!silent);
    if (!silent) showLoading(true);

    // 并行请求所有需要的数据
    // index_data: 大盘指数 | account_collect: 账户汇总+摘要 | fund_hold: 基金持仓列表 | user_account: 用户信息
    var pIndex = YjbAPI.indexData().catch(function (e) { console.warn('[YJB] index_data 失败:', e); return null; });
    var pAccount = YjbAPI.accountCollect().catch(function (e) { console.warn('[YJB] account_collect 失败:', e); return null; });
    var pFunds = YjbAPI.fundHold().catch(function (e) { console.warn('[YJB] fund_hold 失败:', e); return null; });
    var pUser = YjbAPI.userAccount().catch(function (e) { console.warn('[YJB] user_account 失败:', e); return null; });

    Promise.all([pIndex, pAccount, pFunds, pUser]).then(function (results) {
      state.isRefreshing = false;
      setRefreshButtonLoading(false);
      if (!silent) showLoading(false);

      var indexRes = results[0];
      var accRes = results[1];
      var fundRes = results[2];
      var userRes = results[3];
      var previousData = state.data;
      var previousAccounts = state.accounts || [];
      var previousFunds = state.funds || [];
      var previousFundMap = {};
      previousAccounts.forEach(function (acc, i) {
        previousFundMap[getAccountKey(acc, i)] = pick(acc, ['fund_list', 'fundList', 'funds', 'hold_list', 'holdList', 'list']) || [];
        previousFundMap['idx:' + i] = previousFundMap[getAccountKey(acc, i)];
      });

      // ========== 1) 大盘指数数据 ==========
      if (indexRes && indexRes.data) {
        state.indexData = indexRes.data;
        console.log('[YJB] 大盘指数数据已加载，共', Object.keys(state.indexData).length, '条');
      }

      // ========== 2) 账户汇总数据（摘要 + 账户列表） ==========
      if (accRes && accRes.data) {
        var ad = accRes.data;
        console.log('[YJB] account_collect keys:', Object.keys(ad));

        state.data = ad;

        // 账户列表
        var accList = getAccountListFromPayload(ad) || [];
        if (silent && !accList.length && previousAccounts.length) {
          state.data = Object.assign({}, previousData || {}, ad);
          state.accounts = previousAccounts;
          state.data.account_data = state.accounts;
          console.warn('[YJB] account_collect 静默刷新账户为空，保留上一轮账户数据');
        } else {
          state.accounts = accList;
        }
        console.log('[YJB] 账户数量:', state.accounts.length);
      } else {
        if (!state.data) {
          state.data = (indexRes && indexRes.data) || {};
          state.accounts = [];
        }
      }

      // ========== 3) 基金持仓数据（独立的接口！） ==========
      if (fundRes && fundRes.data) {
        var fd = fundRes.data;
        console.log('[YJB] fund_hold 原始数据类型:', typeof fd, Array.isArray(fd) ? '数组长度=' + fd.length : 'keys=' + Object.keys(fd));

        // fund_hold 可能返回: 数组 / {data: [...]} / {list: [...]} / {fund_list: [...]}
        var rawFundList = null;
        if (Array.isArray(fd)) {
          rawFundList = fd;
        } else if (fd.data && Array.isArray(fd.data)) {
          rawFundList = fd.data;
        } else if (fd.list && Array.isArray(fd.list)) {
          rawFundList = fd.list;
        } else {
          rawFundList = pick(fd, ['fund_list', 'fundList', 'funds', 'hold_list', 'items']);
        }

        state.funds = Array.isArray(rawFundList) ? rawFundList : [];
        console.log('[YJB] 基金持仓数量:', state.funds.length);
        if (state.funds.length > 0) {
          console.log('[YJB] funds[0] keys:', Object.keys(state.funds[0]));
          console.log('[YJB] funds[0]:', JSON.stringify(state.funds[0]).substring(0, 500));
          // 打印 nv_info 结构（今日收益/收益率可能在这里）
          if (state.funds[0].nv_info) {
            console.log('[YJB] funds[0].nv_info:', JSON.stringify(state.funds[0].nv_info));
          } else {
            console.log('[YJB] ⚠️ funds[0] 无 nv_info 字段，今日收益需从顶层获取');
          }
        }

        // 将基金列表挂载到各账户上（用于账户 tab 切换时按账户筛选）
        // 如果只有一个账户，全部基金归属该账户
        if (state.accounts.length === 1 && state.funds.length > 0) {
          state.accounts[0].fund_list = state.funds;
          console.log('[YJB] 已将基金挂载到账户 "' + (state.accounts[0].title || '默认') + '"');
        } else if (state.accounts.length === 0 && state.funds.length > 0) {
          // 没有账户数据时，创建一个虚拟账户来容纳基金
          state.accounts.push({
            title: '我的基金',
            fund_list: state.funds,
            today_income: pick(ad || {}, ['today_income', 'todayIncome']),
            today_income_rate: pick(ad || {}, ['today_income_rate', 'todayIncomeRate'])
          });
          console.log('[YJB] 无账户数据，已创建虚拟账户承载基金');
        } else if (state.accounts.length > 1 && state.funds.length > 0) {
          // 多账户场景：尝试按 account_id 分配基金
          state.accounts.forEach(function (acc) {
            acc.fund_list = state.funds.filter(function (f) {
              return f.account_id === acc.account_id;
            });
          });
          // 未分配的基金归入第一个账户
          var unassigned = state.funds.filter(function (f) {
            return !state.accounts.some(function (a) { return (a.fund_list || []).indexOf(f) !== -1; });
          });
          if (unassigned.length && state.accounts[0]) {
            state.accounts[0].fund_list = (state.accounts[0].fund_list || []).concat(unassigned);
          }
        }
      } else {
        if (silent && previousFunds.length) {
          state.funds = previousFunds;
          state.accounts.forEach(function (acc, i) {
            var oldList = previousFundMap[getAccountKey(acc, i)] || previousFundMap['idx:' + i];
            if (oldList && oldList.length) acc.fund_list = oldList;
          });
          if (state.accounts.length === 1 && !(state.accounts[0].fund_list || []).length) {
            state.accounts[0].fund_list = state.funds;
          }
          console.warn('[YJB] fund_hold 静默刷新无数据，保留上一轮基金持仓');
        } else {
          state.funds = [];
          console.log('[YJB] fund_hold 无数据');
        }
      }

      // ========== 4) 用户信息 ==========
      if (userRes && userRes.data) {
        state.isLoggedIn = true;
        loadCachedUserProfile(function (hasProfile) {
          if (!hasProfile) renderUserProfile('', '', true);
        });
      }

      // 同步到 background
      try {
        chrome.runtime.sendMessage({
          type: 'SET_GLOBAL_DATA',
          payload: Object.assign({}, state.data || {}, {
            index_data: state.indexData || {},
            fund_list: state.funds || []
          })
        }).catch(function () {});
      } catch (e) {}

      // 渲染全部
      restoreSelectedAccount(function () {
        refreshAccountLineData(function () {
          renderDataViews();
        });
      });
      scheduleNextRefresh();
    })
    .catch(function () {
      state.isRefreshing = false;
      setRefreshButtonLoading(false);
      if (!silent) showLoading(false);
      if (!silent || !state.data) showError('加载数据失败');
      scheduleNextRefresh();
    });
  }

  /**
   * 渲染大盘指数栏
   * 从 state.indexData 中取主要指数，横向排列（匹配原版截图）
   */
  function renderMarketBar(containerId) {
    var container = document.getElementById(containerId || 'market_bar');
    if (!container) return;
    var data = state.indexData;
    if (!data || !Object.keys(data).length) { setHTML(container, ''); return; }

    // 显示优先级：上证 > 深证成指 > 创业板 > 沪深300 > 上证50 > 科创50
    var order = ['000001', '399001', '399006', '000300', '000016', '000688'];
    var items = [], added = {};
    for (var i = 0; i < order.length; i++) {
      var key = findIndexKey(data, order[i]);
      if (key && data[key]) { items.push(data[key]); added[key] = true; }
    }
    for (var k in data) {
      if (!added[k] && data[k] && data[k].name) items.push(data[k]);
    }

    var html = '';
    items.forEach(function (idx) {
      var dir = parseFloat(idx.dir) || 0;
      var cls = dir >= 0 ? 'text-up' : 'text-down';
      html += '<div class="yjb_market_item">' +
        '<div class="yjb_market_name">' + escapeHtml(idx.name) + '</div>' +
        '<div class="yjb_market_val">' + (idx.v || '--') + '</div>' +
        '<div class="yjb_market_change ' + cls + '">' +
          (idx.div ? idx.div + ' ' : '') + (dir > 0 ? '+' : '') + dir + '%' +
        '</div></div>';
    });
    setHTML(container, html);
  }

  function findIndexKey(data, code) {
    for (var k in data) {
      if (data[k] && (data[k].show_code === code || data[k].code === code)) return k;
    }
    return null;
  }

  /**
   * 渲染账户卡片（"全部"模式：两列紧凑网格 + 迷你折线图；具体账户：隐藏由基金列表替代）
   * ★ 收益详情面板独立渲染到 detail_expand_panel（底部栏下方）
   */
  function renderAccountCard() {
    if (!dom.accountCard) return;
    var d = state.data;
    if (!d) { setHTML(dom.accountCard, ''); return; }

    var accounts = state.accounts;

    // 汇总数据（用于折线图趋势）
    var todayInc = pick(d, ['today_income']);
    var todayRate = pick(d, ['today_income_rate']);

    // ========== 两列账户网格（每张卡片含迷你折线图） ==========
    var gridHtml = '<div class="yjb_acct_grid">';
    accounts.forEach(function (acc, i) {
      var title = pick(acc, ['title', 'name', 'accountName']) || ('账户' + (i + 1));
      var accAssets = pick(acc, ['assets', 'account_assets', 'total_assets']) || pick(d, ['assets_collect']);
      var accTodayInc = pick(acc, ['today_income']) || todayInc;
      var accTodayRate = pick(acc, ['today_income_rate']) || todayRate;
      var upCount = pick(acc, ['up']) || 0;
      var downCount = pick(acc, ['down']) || 0;

      var iconUrl = pick(acc, ['icon']);
      var iconHtml = (iconUrl && iconUrl.startsWith('http'))
        ? '<img src="' + iconUrl + '" style="width:20px;height:20px;border-radius:4px;object-fit:cover;" />'
        : '📊';

      var tiCls = getIncomeClass(accTodayInc);
      var isUp = accTodayInc >= 0;
      var chartColor = isUp ? 'var(--color-up)' : 'var(--color-down)';

      var chartSvg = renderAccountLineChart(getAccountLineList(acc), chartColor, i);

      gridHtml += '<div class="yjb_acct_mini_card" data-account-idx="' + i + '">' +
        '<div class="yjb_acct_mini_left">' +
          '<div class="yjb_acct_mini_header">' +
            '<span class="yjb_acct_mini_icon">' + iconHtml + '</span>' +
            '<span class="yjb_acct_mini_title">' + escapeHtml(title) + '</span>' +
          '</div>' +
          '<div class="yjb_acct_mini_assets">' + formatMoney(accAssets) + '</div>' +
          '<div class="yjb_acct_mini_row">' +
            '<span class="yjb_acct_mini_income ' + tiCls + '">' + formatIncome(accTodayInc) + '</span>' +
            '<span class="yjb_acct_mini_rate ' + tiCls + '">' + formatRate(accTodayRate) + '</span>' +
          '</div>' +
          '<div class="yjb_acct_mini_stats">' +
            '<span class="yjb_acct_stat_up">↑' + upCount + '</span>' +
            '<span class="yjb_acct_stat_down">↓' + downCount + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="yjb_acct_mini_right">' +
          '<div class="yjb_acct_mini_chart_wrap">' + chartSvg + '</div>' +
        '</div>' +
        '</div>';
    });
    gridHtml += '</div>';

    setHTML(dom.accountCard, gridHtml);

    // 绑定小卡片点击 → 跳转到对应账户 tab
    var miniCards = dom.accountCard.querySelectorAll('.yjb_acct_mini_card[data-account-idx]');
    miniCards.forEach(function (card) {
      card.addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-account-idx'), 10);
        if (!isNaN(idx)) {
          applySelectedAccount(idx);
          state.expandedFund = null;
          renderAccountTabs('account_tabs');
          renderAccountTabs('account_tabs_manage');
          renderFundList();
          renderBottomBar('bottom_bar');
          renderBottomBar('bottom_bar_manage');
        }
      });
    });
  }

  /** 切换收益详情面板展开/收起（面板在底部栏下方，展开时把底部栏挤上去） */
  function toggleSummaryExpand() {
    state.summaryExpanded = !state.summaryExpanded;
    // 同步两个视图的面板（主页面 + 管理页）
    var panels = [document.getElementById('detail_expand_panel'), document.getElementById('detail_expand_panel_mg')];
    var arrows = document.querySelectorAll('.yjb_bottom_toggle');

    panels.forEach(function (panel) {
      if (panel) {
        if (state.summaryExpanded) {
          panel.classList.add('yjb_detail_expand_open');
          // 先填充内容再展开（避免空白）
          if (!panel.innerHTML.trim()) renderDetailPanel(panel);
        } else {
          panel.classList.remove('yjb_detail_expand_open');
        }
      }
    });
    arrows.forEach(function (arr) {
      arr.textContent = state.summaryExpanded ? '▲' : '▼';
      arr.classList.toggle('yjb_bottom_toggle_active', state.summaryExpanded);
      arr.style.fontWeight = state.summaryExpanded ? '700' : '';
    });
  }

  /**
   * 渲染收益详情面板内容（5列布局：资产/持有收益/当日收益/跑赢上证/击败基民）
   * @param {HTMLElement} panel - 目标面板容器（默认用 detail_expand_panel）
   */
  function renderDetailPanel(panel) {
    var target = panel || document.getElementById('detail_expand_panel');
    if (!target) return;

    var d = state.data;
    if (!d) { setHTML(target, ''); return; }

    var assets = pick(d, ['assets_collect', 'account_assets', 'total_assets']);
    var holdIncome = pick(d, ['hold_income']);
    var holdRate = pick(d, ['hold_income_rate', 'today_income_rate']);
    var todayInc = pick(d, ['today_income']);
    var todayRate = pick(d, ['today_income_rate']);

    // 跑赢上证 / 击败基民计算
    var shIndex = null;
    if (state.indexData) {
      for (var k in state.indexData) {
        var idx = state.indexData[k];
        if (idx && (idx.show_code === '000001' || idx.code === '000001')) { shIndex = idx; break; }
      }
    }
    var shRate = shIndex ? (parseFloat(shIndex.dir) || 0) : 0;
    var myTodayRate = parseFloat(todayRate) || 0;
    var beatSh = myTodayRate - shRate;
    var beatFund = Math.abs(myTodayRate) > 0.5
      ? (myTodayRate > 0 ? 65 + Math.min(35, Math.abs(myTodayRate) * 10) : 35 - Math.min(30, Math.abs(myTodayRate) * 8))
      : 50;
    beatFund = Math.max(1, Math.min(99.99, beatFund));

    var holdCls = getIncomeClass(holdIncome);
    var todayCls = getIncomeClass(todayInc);
    var beatShCls = getIncomeClass(beatSh);
    var beatFundCls = beatFund >= 50 ? 'text-up' : 'text-down';

    var html =
      '<div class="yjb_acct_detail_panel_inner">' +
        '<div class="yjb_acct_detail_item">' +
          '<div class="yjb_acct_detail_label">账户资产</div>' +
          '<div class="yjb_acct_detail_val">' + formatMoney(assets) + '</div>' +
        '</div>' +
        '<div class="yjb_acct_detail_item">' +
          '<div class="yjb_acct_detail_label">持有收益</div>' +
          '<div class="yjb_acct_detail_val ' + holdCls + '">' + formatIncome(holdIncome) + '</div>' +
          '<div class="yjb_acct_detail_sub ' + holdCls + '">' + formatRate(holdRate) + '</div>' +
        '</div>' +
        '<div class="yjb_acct_detail_item">' +
          '<div class="yjb_acct_detail_label">当日收益</div>' +
          '<div class="yjb_acct_detail_val ' + todayCls + '">' + formatIncome(todayInc) + '</div>' +
          '<div class="yjb_acct_detail_sub ' + todayCls + '">' + formatRate(todayRate) + '</div>' +
        '</div>' +
        '<div class="yjb_acct_detail_item">' +
          '<div class="yjb_acct_detail_label">跑赢上证</div>' +
          '<div class="yjb_acct_detail_val ' + beatShCls + '">' + formatRate(beatSh) + '</div>' +
        '</div>' +
        '<div class="yjb_acct_detail_item">' +
          '<div class="yjb_acct_detail_label">击败基民</div>' +
          '<div class="yjb_acct_detail_val ' + beatFundCls + '">' + beatFund.toFixed(2) + '%' + '</div>' +
        '</div>' +
      '</div>';

    setHTML(target, html);
  }

  /** 生成简易折线图坐标点（右对齐，末点反映涨跌方向） */
  function renderAccountLineChart(lineList, chartColor, idx) {
    var w = 100;
    var h = 56;
    if (!Array.isArray(lineList) || !lineList.length) {
      return '<div class="yjb_mini_chart_empty">--</div>';
    }

    var values = lineList.map(function (item) {
      return Number(item && item.rate);
    }).filter(function (val) {
      return !isNaN(val);
    });

    if (!values.length) {
      return '<div class="yjb_mini_chart_empty">--</div>';
    }

    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min;
    if (range === 0) range = Math.max(Math.abs(max), 1);

    var points = values.map(function (val, i) {
      var x = values.length === 1 ? w : (i / (values.length - 1)) * w;
      var y = h - ((val - min) / range) * (h - 8) - 4;
      return x.toFixed(1) + ',' + Math.max(4, Math.min(h - 4, y)).toFixed(1);
    }).join(' ');
    var last = points.split(' ').pop();
    var lastY = last.split(',')[1];
    var gradId = 'cgrad_' + idx;

    return '<svg class="yjb_mini_chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + chartColor + '" stop-opacity="0.15"/>' +
      '<stop offset="100%" stop-color="' + chartColor + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<polygon points="' + points + ' ' + w + ',' + h + ' 0,' + h + '" fill="url(#' + gradId + ')"/>' +
      '<polyline points="' + points + '" fill="none" stroke="' + chartColor + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + w + '" cy="' + lastY + '" r="2.5" fill="' + chartColor + '"/>' +
      '</svg>';
  }

  function generateFakeChartPoints(w, h, finalVal) {
    var pts = [];
    var steps = 16;
    var isUp = finalVal >= 0;
    // 末点 Y: 盈利偏上(tight), 亏损偏下
    var endY = isUp ? h * 0.28 : h * 0.72;
    for (var i = 0; i <= steps; i++) {
      var x = (i / steps) * w;
      var progress = i / steps;
      // 基线在 50%，加上随机波动，末端向 endY 收敛
      var baseY = h * 0.5 + Math.sin(progress * Math.PI * 2.5) * h * 0.22;
      var noise = (Math.random() - 0.5) * h * 0.10;
      var y = baseY + noise;
      // 最后几个点向 endY 插值
      if (i >= steps - 3) {
        var factor = (i - (steps - 3)) / 3;
        y = y * (1 - factor) + endY * factor;
      }
      pts.push(x.toFixed(1) + ',' + Math.max(2, Math.min(h - 2, y)).toFixed(1));
    }
    return pts.join(' ');
  }

  /**
   * 渲染账户标签页（含"全部"标签，匹配原版）
   */
  function renderAccountTabs(containerId) {
    var container = document.getElementById(containerId || 'account_tabs');
    if (!container) return;
    if (!state.accounts.length) { setHTML(container, ''); return; }

    var idx = state.selectedAccountIdx;
    if (idx >= state.accounts.length) idx = 0;
    applySelectedAccount(idx, false);

    var html = '<div class="yjb_tab' + (idx === -1 ? ' yjb_tab_active' : '') + '" data-idx="-1">全部</div>';
    state.accounts.forEach(function (acc, i) {
      var active = i === idx ? ' yjb_tab_active' : '';
      var accTitle = pick(acc, ['title', 'name', 'account_name', 'platform']);
      html += '<div class="yjb_tab' + active + '" data-idx="' + i + '">' +
        '<span>' + escapeHtml(accTitle || ('账户' + (i + 1))) + '</span></div>';
    });
    setHTML(container, html);
  }

  /**
   * 渲染基金列表（表格形式，匹配原版截图3）
   * 列: 基金名+市值 | 今日涨幅 | 当日收益 | 持有收益(率) | 最新净值
   */
  function renderFundList() {
    if (!dom.fundList) return;

    // ★ "全部"模式：不展示基金列表，只展示账户卡片
    if (state.selectedAccountIdx === -1) {
      dom.fundList.style.display = 'none';
      setHTML(dom.fundList, '');
      // 同时确保卡片可见
      if (dom.accountCard) dom.accountCard.style.display = '';
      return;
    }

    // 具体账户模式：展示基金列表，隐藏卡片
    dom.fundList.style.display = '';
    if (dom.accountCard) dom.accountCard.style.display = 'none';

    var funds = getCurrentFunds();
    funds = sortFunds(funds, state.sortBy, state.sortOrder);

    if (!funds || !funds.length) {
      setHTML(dom.fundList,
        '<div class="yjb_empty"><div class="yjb_empty_icon">📊</div><div class="yjb_empty_text">暂无基金数据</div></div>');
      return;
    }

    // 表头（可排序）
    var sortNames = { income: '当日收益', rate: '今日涨幅', name: '基金名称' };
    var sortArrows = { asc: '↑', desc: '↓' };

    // 获取今天的日期字符串
    var todayStr = formatDate(new Date());
    var yestStr = formatDate(new Date(Date.now() - 86400000));

    var html =
      '<div class="yjb_fund_table_header" id="sort_header">' +
        '<div class="yjb_fund_th yjb_fund_th_name">基金名称</div>' +
        '<div class="yjb_fund_th yjb_fund_th_val">' + (state.sortBy === 'rate' ? sortNames.rate + ' ' + (sortArrows[state.sortOrder] || '') : '今日涨幅') + '<span class="yjb_fund_th_date">' + todayStr + '</span></div>' +
        '<div class="yjb_fund_th yjb_fund_th_inc">' + (state.sortBy === 'income' ? sortNames.income + ' ' + (sortArrows[state.sortOrder] || '') : '当日收益') + '<span class="yjb_fund_th_date">' + todayStr + '</span></div>' +
        '<div class="yjb_fund_th yjb_fund_th_hold">持有收益<span class="yjb_fund_th_date">' + (todayStr.substring(5)) + '</span></div>' +
        '<div class="yjb_fund_th yjb_fund_th_sector">关联涨幅<span class="yjb_fund_th_date">' + todayStr + '</span></div>' +
        '<div class="yjb_fund_th yjb_fund_th_nav">最新净值<span class="yjb_fund_th_date">' + yestStr.substring(5) + '</span></div>' +
      '</div>';

    funds.forEach(function (f) {
      var fCode = pick(f, ['code', 'fund_code', 'fundCode']);
      var fName = pick(f, ['short_name', 'fund_name', 'fundName', 'name', 'display_name']);
      var fMoney = pick(f, ['money', 'market_value']);

      // 今日收益/收益率 — 从 nv_info 计算
      var nvInfo = f.nv_info || null;
      var fIncome, fRate;
      if (nvInfo) {
        var share = parseFloat(pick(f, ['hold_share'])) || 0;
        var zde = parseFloat(nvInfo.zde) || 0;
        fIncome = share * zde;
        var rzzlVal = parseFloat(nvInfo.rzzl);
        fRate = isNaN(rzzlVal) ? (parseFloat(nvInfo.vgszzl) || 0) : rzzlVal;
      } else {
        fIncome = pick(f, ['today_income', 'profit', 'hold_earn']);
        fRate = pick(f, ['today_income_rate', 'rate', 'net_day']);
      }
      var fHoldIncome = pick(f, ['hold_earn', 'hold_income']);
      var fHoldRate = calcHoldRate(f);
      var fNetValue = pick(f, ['last_net']);
      if (nvInfo && nvInfo.dwjz) fNetValue = nvInfo.dwjz;

      // 关联涨幅：从 sector_info 获取
      var sectorInfo = f.sector_info || null;
      var fSectorName = sectorInfo ? (sectorInfo.name || '') : '';
      var fSectorRatio = sectorInfo ? (parseFloat(sectorInfo.ratio) || 0) : null;

      // 今日涨幅：如果 updated_at 不是今天，则不展示
      var updatedToday = isToday(f.updated_at);

      var incomeCls = getIncomeClass(fIncome);
      var holdCls = getIncomeClass(fHoldIncome);

      html += '<div class="yjb_fund_row" data-code="' + escapeHtml(fCode || '') + '">' +
        // 名称 + 市值
        '<div class="yjb_fund_cell_name"><div class="name">' + escapeHtml(fName || fCode || '未知基金') + '</div>' +
          '<div class="money">¥' + formatMoney(fMoney) + '</div></div>' +
        // 今日涨幅（非今日数据则不展示）
        '<div class="yjb_fund_cell yjb_fund_cell_val ' + (updatedToday ? ((fRate >= 0 ? 'text-up' : 'text-down')) : 'text-muted') + '">' +
          (updatedToday ? formatRate(fRate) : '--') + '</div>' +
        // 当日收益
        '<div class="yjb_fund_cell yjb_fund_cell_inc ' + incomeCls + '">' +
          formatIncome(fIncome) + '</div>' +
        // 持有收益
        '<div class="yjb_fund_cell yjb_fund_cell_hold ' + holdCls + '">' +
          formatIncome(fHoldIncome) + '<span class="sub">' + formatRate(fHoldRate) + '</span></div>' +
        // 关联涨幅
        '<div class="yjb_fund_cell yjb_fund_cell_sector' + (fSectorRatio !== null ? (' ' + (fSectorRatio >= 0 ? 'text-up' : 'text-down')) : '') + '">' +
          (escapeHtml(fSectorName) || '--') + '<span class="sub">' + (fSectorRatio !== null ? formatRate(fSectorRatio) : '--') + '</span></div>' +
        // 最新净值
        '<div class="yjb_fund_cell yjb_fund_cell_nav">' +
          (fNetValue ? fNetValue : '--') + '</div>' +
        '</div>';
    });

    setHTML(dom.fundList, html);

    // 绑定排序点击事件
    var sortHeader = document.getElementById('sort_header');
    if (sortHeader) {
      sortHeader.addEventListener('click', function () { cycleSort(); });
    }
  }

  /** 格式化日期为 MM-DD */
  function formatDate(d) {
    return ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /** 判断 updated_at 是否是今天 */
  function isToday(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr);
    var now = new Date();
    return d.getFullYear() === now.getFullYear() &&
           d.getMonth() === now.getMonth() &&
           d.getDate() === now.getDate();
  }

  /** 计算持有收益率：hold_earn / cost_money * 100 */
  function calcHoldRate(f) {
    var earn = parseFloat(pick(f, ['hold_earn', 'hold_income'])) || 0;
    var cost = parseFloat(pick(f, ['cost_money'])) || 0;
    if (cost === 0) return 0;
    return (earn / cost) * 100;
  }

  /**
   * 获取当前选中账户的基金列表
   */
  function getCurrentFunds() {
    if (!state.data) return [];

    // 如果选中的是"总览"，合并所有账户的基金
    if (state.selectedAccountIdx === -1) {
      var allFunds = [];
      (state.accounts || []).forEach(function (acc) {
        var fundList = pick(acc, ['fund_list', 'fundList', 'funds', 'hold_list', 'holdList', 'list']);
        if (fundList && fundList.length) {
          allFunds = allFunds.concat(fundList);
        }
      });
      return allFunds;
    }

    // 返回指定账户的基金
    var acc = state.accounts[state.selectedAccountIdx];
    if (!acc) return [];
    return pick(acc, ['fund_list', 'fundList', 'funds', 'hold_list', 'holdList', 'list']) || [];
  }

  /**
   * 排序基金列表
   */
  function sortFunds(funds, by, order) {
    if (!funds) return [];
    var sorted = funds.slice();
    sorted.sort(function (a, b) {
      var va, vb;
      switch (by) {
        case 'name':
          va = (pick(a, ['short_name', 'name', 'fund_name', 'code']) || '').toLowerCase();
          vb = (pick(b, ['short_name', 'name', 'fund_name', 'code']) || '').toLowerCase();
          return va.localeCompare(vb, 'zh');
        case 'rate':
          var raRzzl = a.nv_info ? parseFloat(a.nv_info.rzzl) : NaN;
          var ra = a.nv_info ? (isNaN(raRzzl) ? (parseFloat(a.nv_info.vgszzl) || 0) : raRzzl) : null;
          var rbRzzl = b.nv_info ? parseFloat(b.nv_info.rzzl) : NaN;
          var rb = b.nv_info ? (isNaN(rbRzzl) ? (parseFloat(b.nv_info.vgszzl) || 0) : rbRzzl) : null;
          if (ra === undefined || ra === null) ra = parseFloat(pick(a, ['year_increase_rate', 'today_income_rate', 'rate'])) || 0;
          if (rb === undefined || rb === null) rb = parseFloat(pick(b, ['year_increase_rate', 'today_income_rate', 'rate'])) || 0;
          va = ra; vb = rb;
          break;
        default: // income — 用份额×涨跌额计算
          var ia = a.nv_info ? (parseFloat(a.nv_info.zde) || 0) * (parseFloat(a.hold_share) || 0) : null;
          var ib = b.nv_info ? (parseFloat(b.nv_info.zde) || 0) * (parseFloat(b.hold_share) || 0) : null;
          if (ia === undefined || ia === null) ia = parseFloat(pick(a, ['today_income', 'todayIncome', 'hold_earn'])) || 0;
          if (ib === undefined || ib === null) ib = parseFloat(pick(b, ['today_income', 'todayIncome', 'hold_earn'])) || 0;
          va = ia; vb = ib;
          break;
      }
      return order === 'asc' ? va - vb : vb - va;
    });
    return sorted;
  }

  /**
   * 切换排序方式
   */
  function cycleSort() {
    var keys = ['income', 'rate', 'name'];
    var orders = ['desc', 'asc'];
    var currentKeyIdx = keys.indexOf(state.sortBy);

    // 先切换方向，如果已经在 asc 则切换到下一个字段
    if (state.sortOrder === 'asc') {
      state.sortOrder = 'desc';
      state.sortBy = keys[(currentKeyIdx + 1) % keys.length];
    } else {
      state.sortOrder = 'asc';
    }
    renderFundList();
  }

  /**
   * 展开/收起基金详情
   */
  function toggleFundDetail(code) {
    state.expandedFund = state.expandedFund === code ? null : code;
    renderFundList();
  }

  // =============================================
  // 管理页面
  // =============================================

  function renderManageList(keyword) {
    if (!dom.manageList) return;

    keyword = (keyword || '').trim().toLowerCase();

    // 收集所有基金（去重）
    var allFunds = [];
    var seen = {};
    (state.accounts || []).forEach(function (acc) {
      var fundList = pick(acc, ['fund_list', 'fundList', 'funds', 'hold_list', 'list']) || [];
      fundList.forEach(function (f) {
        var code = pick(f, ['code', 'fund_code', 'fundCode']) || '';
        if (code && !seen[code]) {
          seen[code] = true;
          var fName = pick(f, ['short_name', 'fund_name', 'name']) || '';
          if (!keyword || fName.toLowerCase().indexOf(keyword) > -1 || code.indexOf(keyword) > -1) {
            allFunds.push(f);
          }
        }
      });
    });

    // 表头日期
    var todayStr = formatDate(new Date());
    var yestStr = formatDate(new Date(Date.now() - 86400000));

    if (!allFunds.length) {
      setHTML(dom.manageList,
        '<div class="yjb_empty"><div class="yjb_empty_icon">🔍</div><div class="yjb_empty_text">' +
        (keyword ? '未找到匹配的基金' : '暂无基金') + '</div></div>');
      return;
    }

    // 管理页标题行（"持有管理 ✎"）
    var html = '<div class="yjb_manage_section_header"><span>持有管理</span><span>✎</span></div>';

    // 表头
    html += '<div class="yjb_fund_table_header">' +
      '<div class="yjb_fund_th yjb_fund_th_name"></div>' +
      '<div class="yjb_fund_th yjb_fund_th_val">今日涨幅<span class="yjb_fund_th_date">' + todayStr + '</span></div>' +
      '<div class="yjb_fund_th yjb_fund_th_inc">当日收益<span class="yjb_fund_th_date">' + todayStr + '</span></div>' +
      '<div class="yjb_fund_th yjb_fund_th_hold">持有收益<span class="yjb_fund_th_date">' + todayStr.substring(5) + '</span></div>' +
      '<div class="yjb_fund_th yjb_fund_th_sector">关联涨幅<span class="yjb_fund_th_date">' + todayStr + '</span></div>' +
      '<div class="yjb_fund_th yjb_fund_th_nav">最新净值<span class="yjb_fund_th_date">' + yestStr.substring(5) + '</span></div>' +
      '</div>';

    allFunds.forEach(function (f) {
      var mCode = pick(f, ['code', 'fund_code']) || '';
      var mName = pick(f, ['short_name', 'fund_name', 'name']) || '未知基金';
      var mMoney = pick(f, ['money']);

      var nvInfo = f.nv_info || null;
      var fInc, fRate;
      if (nvInfo) {
        var share = parseFloat(pick(f, ['hold_share'])) || 0;
        var zde = parseFloat(nvInfo.zde) || 0;
        fInc = share * zde;
        var rzzlVal = parseFloat(nvInfo.rzzl);
        fRate = isNaN(rzzlVal) ? (parseFloat(nvInfo.vgszzl) || 0) : rzzlVal;
      } else {
        fInc = pick(f, ['today_income']);
        fRate = pick(f, ['today_income_rate', 'rate']);
      }
      var fHoldInc = pick(f, ['hold_earn']);
      var fHoldRate = calcHoldRate(f);
      var fNav = pick(f, ['last_net']);
      if (nvInfo && nvInfo.dwjz) fNav = nvInfo.dwjz;

      // 关联涨幅：从 sector_info 获取
      var sectorInfo = f.sector_info || null;
      var fSectorName = sectorInfo ? (sectorInfo.name || '') : '';
      var fSectorRatio = sectorInfo ? (parseFloat(sectorInfo.ratio) || 0) : null;

      // 今日涨幅：如果 updated_at 不是今天，则不展示
      var updatedToday = isToday(f.updated_at);

      var incCls = getIncomeClass(fInc);
      var holdCls = getIncomeClass(fHoldInc);

      html += '<div class="yjb_fund_row" data-code="' + mCode + '">' +
        '<div class="yjb_fund_cell_name"><div class="name">' + escapeHtml(mName) + '</div>' +
          '<div class="money">¥' + formatMoney(mMoney) + '</div></div>' +
        '<div class="yjb_fund_cell yjb_fund_cell_val ' + (updatedToday ? (fRate >= 0 ? 'text-up' : 'text-down') : 'text-muted') + '">' +
          (updatedToday ? formatRate(fRate) : '--') + '</div>' +
        '<div class="yjb_fund_cell yjb_fund_cell_inc ' + incCls + '">' + formatIncome(fInc) + '</div>' +
        '<div class="yjb_fund_cell yjb_fund_cell_hold ' + holdCls + '">' + formatIncome(fHoldInc) + '<span class="sub">' + formatRate(fHoldRate) + '</span></div>' +
        '<div class="yjb_fund_cell yjb_fund_cell_sector' + (fSectorRatio !== null ? (' ' + (fSectorRatio >= 0 ? 'text-up' : 'text-down')) : '') + '">' +
          (escapeHtml(fSectorName) || '--') + '<span class="sub">' + (fSectorRatio !== null ? formatRate(fSectorRatio) : '--') + '</span></div>' +
        '<div class="yjb_fund_cell yjb_fund_cell_nav">' + (fNav || '--') + '</div>' +
        '</div>';
    });

    setHTML(dom.manageList, html);
  }

  /**
   * 渲染底部操作栏（+新增持有 ¥资产 ↑n ↓n 收益摘要）
   */
  function renderBottomBar(barId) {
    var bar = document.getElementById(barId || 'bottom_bar');
    if (!bar) return;

    var d = state.data;
    if (!d) return;

    var assets = pick(d, ['assets_collect', 'account_assets']);
    var income = pick(d, ['today_income']);
    var rate = pick(d, ['today_income_rate']);

    // 账户涨跌数
    var acc = state.accounts[0] || {};
    var upCount = pick(acc, ['up']) || 0;
    var downCount = pick(acc, ['down']) || 0;

    // 根据容器选择对应 DOM 元素
    var isManage = barId === 'bottom_bar_manage';
    var elAssets = document.getElementById(isManage ? 'bottom_assets_mg' : 'bottom_assets');
    var elUp = document.getElementById(isManage ? 'bottom_up_mg' : 'bottom_up');
    var elDown = document.getElementById(isManage ? 'bottom_down_mg' : 'bottom_down');
    var elIncome = document.getElementById(isManage ? 'bottom_income_mg' : 'bottom_income');

    if (elAssets) elAssets.textContent = '¥ ' + formatMoney(assets);
    if (elUp) elUp.textContent = '↑ ' + upCount;
    if (elDown) elDown.textContent = '↓ ' + downCount;
    if (elIncome) {
      var cls = getIncomeClass(income);
      elIncome.textContent = '今日收益: ' + formatIncome(income) + ' (' + formatRate(rate) + ')';
      elIncome.className = 'yjb_bottom_income ' + cls;
    }
  }

  // =============================================
  // 添加基金
  // =============================================

  var searchDebounceTimer = null;

  function onFundCodeInput() {
    var code = dom.addFundCode ? dom.addFundCode.value.trim() : '';

    clearTimeout(searchDebounceTimer);
    if (!code || code.length < 2) {
      if (dom.fundSearchResult) dom.fundSearchResult.style.display = 'none';
      return;
    }

    searchDebounceTimer = setTimeout(function () {
      searchFund(code);
    }, 300);
  }

  function searchFund(keyword) {
    YjbAPI.searchFund(keyword)
      .then(function (res) {
        var list = normalizeFundSearchResults(res);
        if (!list.length) {
          if (dom.fundSearchResult) {
            setHTML(dom.fundSearchResult, '<div class="yjb_inline_hint">未找到相关基金</div>');
            dom.fundSearchResult.style.display = 'block';
          }
          return;
        }

        var html = '';
        list.forEach(function (item) {
          var code = pick(item, ['fund_code', 'fundCode', 'code']) || '';
          var name = pick(item, ['short_name', 'shortName', 'fund_name', 'fundName', 'name']) || '';
          html += '<div class="yjb_search_result_item" data-code="' + escapeHtml(code) +
            '" data-name="' + escapeHtml(name) + '" ' +
            'onclick="YjbPopup.selectSearchResult(this)">' +
            '<span>' + escapeHtml(name) + '</span>' +
            '<span class="yjb_search_result_code">' + escapeHtml(code) + '</span>' +
            '</div>';
        });

        if (dom.fundSearchResult) {
          setHTML(dom.fundSearchResult, html);
          dom.fundSearchResult.style.display = 'block';
        }
      })
      .catch(function () {
        if (dom.fundSearchResult) {
          setHTML(dom.fundSearchResult, '<div class="yjb_inline_hint text-up">搜索失败</div>');
          dom.fundSearchResult.style.display = 'block';
        }
      });
  }

  function normalizeFundSearchResults(res) {
    if (!res) return [];
    var data = res.data !== undefined ? res.data : res;
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];

    var list = pick(data, ['list', 'items', 'fund_list', 'fundList', 'data', 'result', 'results']);
    return Array.isArray(list) ? list : [];
  }

  function selectSearchResult(el) {
    var code = el.getAttribute('data-code');
    var name = el.getAttribute('data-name');
    if (dom.addFundCode) dom.addFundCode.value = code || '';
    if (dom.addFundName) dom.addFundName.value = name || '';
    if (dom.fundSearchResult) dom.fundSearchResult.style.display = 'none';
  }

  function confirmAddFund() {
    var code = dom.addFundCode ? dom.addFundCode.value.trim() : '';
    if (!code || code.length !== 6) {
      alert('请输入有效的6位基金代码');
      return;
    }

    showLoading(true);
    YjbAPI.addFundHold({ fund_code: code })
      .then(function () {
        showLoading(false);
        alert('添加成功！');
        loadIndexData(); // 刷新数据
      })
      .catch(function (err) {
        showLoading(false);
        alert('添加失败：' + err.message);
      });
  }

  // =============================================
  // 登录流程
  // =============================================

  function startLogin() {
    hideDialog('dialog_login');
    showDialog('dialog_login');

    // 获取二维码
    fetchQRCode();
  }

  function fetchQRCode() {
    if (dom.loginQrHint) setHTML(dom.loginQrHint, '正在获取二维码...');
    if (dom.loginQrImg) setHTML(dom.loginQrImg, '<p class="yjb_inline_hint">加载中...</p>');

    YjbAPI.qrCode()
      .then(function (res) {
        if (!res || !res.data) throw new Error('获取二维码失败');

        var data = res.data;
        state.qrEventId = data.event_id || data.eventId || data.id;

        // 渲染二维码图片
        // 1) API 直接返回图片（base64 或图片 URL）
        if (data.qr_code || data.qrCode) {
          if (dom.loginQrImg) setHTML(dom.loginQrImg,
            '<img src="data:image/png;base64,' + (data.qr_code || data.qrCode) + '" alt="登录二维码" />');
        } else if (data.qr_code_url || data.qrCodeUrl) {
          if (dom.loginQrImg) setHTML(dom.loginQrImg,
            '<img src="' + (data.qr_code_url || data.qrCodeUrl) + '" alt="登录二维码" />');
        // 2) API 返回文本 URL → 用 qrcode-generator 生成二维码图片
        } else if (data.url && typeof qrcode !== 'undefined') {
          try {
            var qr = qrcode(0, 'M');           // 自动版本号，中等纠错级别
            qr.addData(data.url);
            qr.make();
            var qrImgTag = qr.createImgTag(4, 10, '登录二维码');  // 每格4px，边距40px
            if (dom.loginQrImg) setHTML(dom.loginQrImg, qrImgTag);
          } catch (e) {
            if (dom.loginQrImg) setHTML(dom.loginQrImg,
              '<p class="yjb_inline_hint text-up">生成二维码失败</p>');
          }
        }

        if (dom.loginQrHint) setHTML(dom.loginQrHint, '请使用微信扫一扫登录');

        // 开始轮询扫码状态
        startQRPolling();
      })
      .catch(function (err) {
        if (dom.loginQrHint) setHTML(dom.loginQrHint, '获取失败：' + err.message);
      });
  }

  function startQRPolling() {
    stopQRPolling();

    state.qrPollTimer = setInterval(function () {
      if (!state.qrEventId) return;

      YjbAPI.qrCodeState(state.qrEventId)
        .then(function (res) {
          if (!res || !res.data) return;

          // 兼容数字和字符串两种格式
          var status = res.data.status || res.data.state;

          switch (status) {
            case 'SCANNED':
            case 1:
              if (dom.loginQrHint) setHTML(dom.loginQrHint, '已扫描，等待确认...');
              break;
            case 'CONFIRMED':
            case 'success':
            case 2:
              stopQRPolling();
              if (dom.loginQrHint) setHTML(dom.loginQrHint, '登录成功！');
              state.isLoggedIn = true;

              // ★ 直接用登录响应中的用户信息更新 UI（不等二次请求）
              var loginNickname = pick(res.data, ['nickname', 'nick_name', 'name']);
              var loginAvatar = pick(res.data, ['avatar', 'avatar_url', 'head_img']);
              renderUserProfile(loginNickname, loginAvatar, true);
              cacheUserProfile(loginNickname, loginAvatar);

              // 存储 token
              if (res.data.token) {
                YjbAPI.token.set(res.data.token).then(function () {
                  loadIndexData(); // 重新加载数据
                });
              }

              setTimeout(function () {
                hideDialog('dialog_login');
                loadIndexData();
              }, 1000);
              break;
            case 'EXPIRED':
            case 'expired':
            case 3:
              stopQRPolling();
              if (dom.loginQrHint) setHTML(dom.loginQrHint, '二维码已过期，请刷新');
              break;
            case 'CANCELED':
            case 'canceled':
            case 4:
              stopQRPolling();
              if (dom.loginQrHint) setHTML(dom.loginQrHint, '已取消扫描');
              break;
          }
        })
        .catch(function () {
          // 静默处理轮询错误
        });
    }, 2000); // 每2秒查询一次
  }

  function stopQRPolling() {
    if (state.qrPollTimer) {
      clearInterval(state.qrPollTimer);
      state.qrPollTimer = null;
    }
  }

  // =============================================
  // 用户信息 & 配置面板
  // =============================================

  function updateUserInfo() {
    loadCachedUserProfile(function (hasProfile) {
      YjbAPI.userAccount().then(function (res) {
        if (res && res.data) {
          state.isLoggedIn = true;
          if (!hasProfile) renderUserProfile('', '', true);
        } else if (!hasProfile) {
          state.isLoggedIn = false;
          renderUserProfile('', '', false);
        }
      }).catch(function () {
        if (!hasProfile && !state.isLoggedIn) renderUserProfile('', '', false);
      });
    });
  }

  // =============================================
  // Webhook 配置
  // =============================================

  function loadWebhookConfig() {
    chrome.storage.local.get(
      ['webhookEnabled', 'webhookUrl', 'webhookInterval',
        'webhookTimedEnabled', 'webhookDailyEnabled', 'webhookWeeklyEnabled', 'webhookMonthlyEnabled'],
      function (result) {
        state.webhookConfig.enabled = result.webhookEnabled || false;
        state.webhookConfig.url = result.webhookUrl || '';
        state.webhookConfig.interval = result.webhookInterval || 5;
        state.webhookConfig.timedEnabled = result.webhookTimedEnabled !== false;
        state.webhookConfig.dailyEnabled = result.webhookDailyEnabled === true;
        state.webhookConfig.weeklyEnabled = result.webhookWeeklyEnabled === true;
        state.webhookConfig.monthlyEnabled = result.webhookMonthlyEnabled === true;

        // 同步到 UI
        if (dom.whToggle) dom.whToggle.checked = state.webhookConfig.enabled;
        if (dom.whUrl) dom.whUrl.value = state.webhookConfig.url;
        if (dom.whInterval) dom.whInterval.value = String(state.webhookConfig.interval);
        if (dom.whTimedToggle) dom.whTimedToggle.checked = state.webhookConfig.timedEnabled;
        if (dom.whDailyToggle) dom.whDailyToggle.checked = state.webhookConfig.dailyEnabled;
        if (dom.whWeeklyToggle) dom.whWeeklyToggle.checked = state.webhookConfig.weeklyEnabled;
        if (dom.whMonthlyToggle) dom.whMonthlyToggle.checked = state.webhookConfig.monthlyEnabled;
        if (dom.whFields) dom.whFields.style.display = state.webhookConfig.enabled ? '' : 'none';
      }
    );
  }

  function onWhToggleChange() {
    var enabled = dom.whToggle ? dom.whToggle.checked : false;
    if (dom.whFields) dom.whFields.style.display = enabled ? '' : 'none';
    state.webhookConfig.enabled = enabled;
  }

  function collectWebhookConfig() {
    state.webhookConfig.url = dom.whUrl ? dom.whUrl.value.trim() : '';
    state.webhookConfig.interval = parseInt(dom.whInterval ? dom.whInterval.value : '5', 10) || 5;
    state.webhookConfig.timedEnabled = dom.whTimedToggle ? dom.whTimedToggle.checked : state.webhookConfig.timedEnabled;
    state.webhookConfig.dailyEnabled = dom.whDailyToggle ? dom.whDailyToggle.checked : state.webhookConfig.dailyEnabled;
    state.webhookConfig.weeklyEnabled = dom.whWeeklyToggle ? dom.whWeeklyToggle.checked : state.webhookConfig.weeklyEnabled;
    state.webhookConfig.monthlyEnabled = dom.whMonthlyToggle ? dom.whMonthlyToggle.checked : state.webhookConfig.monthlyEnabled;

    if (state.webhookConfig.enabled && !state.webhookConfig.url) {
      alert('请输入 Webhook 地址');
      return false;
    }

    // 验证 URL 格式
    if (state.webhookConfig.url && state.webhookConfig.url.indexOf('https://qyapi.weixin.qq.com') === -1 &&
      state.webhookConfig.url.indexOf('http') !== 0) {
      alert('请输入有效的企微机器人 Webhook 地址');
      return false;
    }
    return true;
  }

  function persistWebhookConfig(callback) {
    if (!collectWebhookConfig()) return;

    // 保存到 storage
    chrome.storage.local.set({
      webhookEnabled: state.webhookConfig.enabled,
      webhookUrl: state.webhookConfig.url,
      webhookInterval: state.webhookConfig.interval,
      webhookTimedEnabled: state.webhookConfig.timedEnabled,
      webhookDailyEnabled: state.webhookConfig.dailyEnabled,
      webhookWeeklyEnabled: state.webhookConfig.weeklyEnabled,
      webhookMonthlyEnabled: state.webhookConfig.monthlyEnabled
    }, function () {
      // 通知 background 更新 alarm
      try {
        chrome.runtime.sendMessage({
          type: 'UPDATE_WEBHOOK_ALARM',
          interval: state.webhookConfig.interval,
          enabled: state.webhookConfig.enabled,
          timedEnabled: state.webhookConfig.timedEnabled,
          dailyEnabled: state.webhookConfig.dailyEnabled,
          weeklyEnabled: state.webhookConfig.weeklyEnabled,
          monthlyEnabled: state.webhookConfig.monthlyEnabled
        }).catch(function () {});
      } catch (e) {}

      if (callback) callback();
    });
  }

  function saveWebhookConfig() {
    persistWebhookConfig(function () {
      alert('保存成功！');

      // 关闭面板
      closeSidePanel('panel_webhook');
    });
  }

  function getWebhookTestButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('.yjb_wh_test_btn'));
  }

  function setWebhookTestLoading(loading, activeBtn) {
    getWebhookTestButtons().forEach(function (btn) {
      btn.disabled = !!loading;
      btn.textContent = loading && btn === activeBtn ? '推送中...' : (btn.getAttribute('data-label') || '测试推送');
    });
  }

  function testWebhookPush(kind, activeBtn) {
    kind = kind || 'test';
    state.webhookConfig.enabled = true;
    if (dom.whToggle) dom.whToggle.checked = true;
    if (dom.whFields) dom.whFields.style.display = '';

    persistWebhookConfig(function () {
      setWebhookTestLoading(true, activeBtn);
      try {
        chrome.runtime.sendMessage({ type: 'TEST_WEBHOOK', kind: kind }, function (res) {
          setWebhookTestLoading(false, activeBtn);
          var label = activeBtn ? (activeBtn.getAttribute('data-label') || '测试推送') : '测试推送';
          if (chrome.runtime.lastError) {
            alert(label + '失败：' + chrome.runtime.lastError.message);
            return;
          }
          if (res && res.ok) {
            alert(label + '已发送');
          } else {
            alert(label + '失败：' + ((res && res.error) || '未知错误'));
          }
        });
      } catch (e) {
        setWebhookTestLoading(false, activeBtn);
        alert('测试推送失败：' + e.message);
      }
    });
  }

  function getPeriodTestButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('.yjb_period_test_btn'));
  }

  function setPeriodTestLoading(loading, activeBtn) {
    getPeriodTestButtons().forEach(function (btn) {
      btn.disabled = !!loading;
      btn.textContent = loading && btn === activeBtn ? '测试中...' : (btn.getAttribute('data-label') || '测试');
    });
  }

  function setPeriodTestResult(payload) {
    if (!dom.periodTestResult) return;
    dom.periodTestResult.value = JSON.stringify(payload, null, 2);
  }

  function testPeriodData(dateType, activeBtn) {
    dateType = String(dateType || 'day').trim() || 'day';
    setPeriodTestLoading(true, activeBtn);
    setPeriodTestResult({
      ok: true,
      status: 'requesting',
      date_type: dateType
    });

    try {
      chrome.runtime.sendMessage({ type: 'TEST_PERIOD_DATA', dateType: dateType }, function (res) {
        setPeriodTestLoading(false, activeBtn);
        if (chrome.runtime.lastError) {
          setPeriodTestResult({
            ok: false,
            date_type: dateType,
            error: chrome.runtime.lastError.message
          });
          return;
        }
        setPeriodTestResult(res || {
          ok: false,
          date_type: dateType,
          error: '后台未返回数据'
        });
      });
    } catch (e) {
      setPeriodTestLoading(false, activeBtn);
      setPeriodTestResult({
        ok: false,
        date_type: dateType,
        error: e.message
      });
    }
  }

  function copyPeriodTestResult() {
    if (!dom.periodTestResult || !dom.periodTestResult.value) {
      alert('暂无测试结果');
      return;
    }

    var text = dom.periodTestResult.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        alert('已复制测试结果');
      }).catch(function () {
        dom.periodTestResult.select();
        document.execCommand('copy');
        alert('已复制测试结果');
      });
      return;
    }

    dom.periodTestResult.select();
    document.execCommand('copy');
    alert('已复制测试结果');
  }

  // =============================================
  // 基金操作（管理页面）
  // =============================================

  window.YjbPopup = {
    selectSearchResult: selectSearchResult,
    toggleFundDetail: toggleFundDetail,
    pinFund: function (code) {
      alert('置顶功能：' + code + '（待后端支持）');
    },
    deleteFund: function (code) {
      showConfirm('确定要删除基金 ' + code + ' 吗？', function () {
        showLoading(true);
        YjbAPI.deleteFundHold({ fund_code: code })
          .then(function () {
            showLoading(false);
            alert('删除成功');
            loadIndexData();
          })
          .catch(function (err) {
            showLoading(false);
            alert('删除失败：' + err.message);
          });
      });
    }
  };

  // =============================================
  // 确认对话框
  // =============================================

  var confirmCallback = null;

  function showConfirm(msg, callback) {
    if (dom.confirmMsg) setHTML(dom.confirmMsg, msg);
    confirmCallback = callback;
    showDialog('dialog_confirm');
  }

  // =============================================
  // 空状态 & 错误
  // =============================================

  function renderEmpty() {
    if (dom.fundList) setHTML(dom.fundList,
      '<div class="yjb_empty"><div class="yjb_empty_icon">📊</div><div class="yjb_empty_text">暂无数据，请先登录</div></div>');
  }

  function showError(msg) {
    if (dom.fundList) setHTML(dom.fundList,
      '<div class="yjb_empty"><div class="yjb_empty_icon">⚠️</div><div class="yjb_empty_text">' + escapeHtml(msg) + '</div></div>');
  }

  // =============================================
  // HTML 转义
  // =============================================

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // =============================================
  // 事件绑定
  // =============================================

  function bindEvents() {

    // ---- 标题栏 ----
    if (dom.btnSettings) {
      dom.btnSettings.addEventListener('click', function () {
        openSidePanel('panel_config');
        loadCachedUserProfile();
        updateUserInfo();
        loadWebhookConfig();
        syncRefreshControls();
      });
    }
    if (dom.btnRefreshNow) {
      dom.btnRefreshNow.addEventListener('click', function () {
        loadIndexData({ source: 'manual' });
      });
    }

    // ---- 底部操作栏导航 ----
    // 首页/管理/添加 通过底部栏的 +新增持有 和各区域隐式切换
    if (dom.navManage) dom.navManage.addEventListener('click', function () {
      switchView('manage');
      renderMarketBar('market_bar_manage');
      renderAccountTabs('account_tabs_manage');
      if (!state.data || !state.accounts.length) { loadIndexData(); }
      renderManageList();
      renderBottomBar('bottom_bar_manage');
    });
    if (dom.navAdd) dom.navAdd.addEventListener('click', function () { switchView('add'); });

    // 底部栏 "新增持有" 按钮
    var addQuickHandler = function () { switchView('add'); };
    if (dom.btnAddQuick) dom.btnAddQuick.addEventListener('click', addQuickHandler);
    if (dom.btnAddQuickMg) dom.btnAddQuickMg.addEventListener('click', addQuickHandler);

    // ---- 管理页返回 ----
    if (dom.btnBackFromManage) dom.btnBackFromManage.addEventListener('click', function () { switchView('main'); });
    if (dom.btnBackFromAdd) dom.btnBackFromAdd.addEventListener('click', function () { switchView('main'); });

    // ---- 搜索 ----
    if (dom.searchInput) {
      dom.searchInput.addEventListener('input', function () {
        state.manageSearchKeyword = dom.searchInput.value;
        renderManageList(dom.searchInput.value);
      });
    }

    // ---- 添加基金输入 ----
    if (dom.addFundCode) dom.addFundCode.addEventListener('input', onFundCodeInput);
    if (dom.btnAddFundConfirm) dom.btnAddFundConfirm.addEventListener('click', confirmAddFund);

    // ---- 添加方式标签切换 ----
    var addTabs = document.querySelectorAll('.yjb_add_tab');
    addTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var tabName = this.getAttribute('data-tab');
        addTabs.forEach(function (t) { t.classList.remove('yjb_add_tab_active'); });
        this.classList.add('yjb_add_tab_active');

        if (tabName === 'manual') {
          if (dom.addManualPanel) dom.addManualPanel.style.display = '';
          if (dom.addQrcodePanel) dom.addQrcodePanel.style.display = 'none';
        } else {
          if (dom.addManualPanel) dom.addManualPanel.style.display = 'none';
          if (dom.addQrcodePanel) dom.addQrcodePanel.style.display = '';
        }
      });
    });

    // ---- 配置面板 ----
    if (dom.btnCloseConfig) dom.btnCloseConfig.addEventListener('click', function () { closeSidePanel('panel_config'); });
    if (dom.themeGrid) {
      dom.themeGrid.addEventListener('click', function (e) {
        var btn = e.target.closest('.yjb_theme_option');
        if (!btn) return;
        applyTheme(btn.getAttribute('data-theme'));
      });
    }
    if (dom.refreshToggle) dom.refreshToggle.addEventListener('change', saveRefreshConfig);
    if (dom.refreshInterval) dom.refreshInterval.addEventListener('change', saveRefreshConfig);
    getPeriodTestButtons().forEach(function (btn) {
      btn.addEventListener('click', function () {
        testPeriodData(btn.getAttribute('data-date-type') || 'day', btn);
      });
    });
    if (dom.periodTestCopyBtn) dom.periodTestCopyBtn.addEventListener('click', copyPeriodTestResult);
    if (dom.btnLogin) dom.btnLogin.addEventListener('click', function () {
      if (state.isLoggedIn) {
        // 退出登录
        state.isLoggedIn = false;
        clearCachedUserProfile();
        renderUserProfile('', '', false);
        closeSidePanel('panel_config');
        YjbAPI.token.set('').then(function () {
          loadIndexData();
        });
      } else {
        closeSidePanel('panel_config');
        startLogin();
      }
    });

    // Webhook 入口
    if (dom.btnOpenWebhook) dom.btnOpenWebhook.addEventListener('click', function () {
      closeSidePanel('panel_config');
      loadWebhookConfig();
      openSidePanel('panel_webhook');
    });

    // ---- Webhook 面板 ----
    if (dom.btnCloseWebhook) dom.btnCloseWebhook.addEventListener('click', function () { closeSidePanel('panel_webhook'); });
    if (dom.whToggle) dom.whToggle.addEventListener('change', onWhToggleChange);
    if (dom.whSaveBtn) dom.whSaveBtn.addEventListener('click', saveWebhookConfig);
    getWebhookTestButtons().forEach(function (btn) {
      btn.addEventListener('click', function () {
        testWebhookPush(btn.getAttribute('data-kind') || 'test', btn);
      });
    });

    // ---- 登录弹窗 ----
    if (dom.btnCloseLogin) dom.btnCloseLogin.addEventListener('click', function () {
      stopQRPolling();
      hideDialog('dialog_login');
    });
    if (dom.btnRefreshQr) dom.btnRefreshQr.addEventListener('click', fetchQRCode);

    // ---- 版本更新弹窗 ----
    if (dom.btnSkipVersion) dom.btnSkipVersion.addEventListener('click', function () { hideDialog('dialog_version'); });
    if (dom.btnGoUpdate) dom.btnGoUpdate.addEventListener('click', function () {
      // 打开官网或应用商店
      chrome.tabs.create({ url: 'https://www.yangjibao.com/' });
    });

    // ---- 确认对话框 ----
    if (dom.confirmCancel) dom.confirmCancel.addEventListener('click', function () {
      confirmCallback = null;
      hideDialog('dialog_confirm');
    });
    if (dom.confirmOk) dom.confirmOk.addEventListener('click', function () {
      hideDialog('dialog_confirm');
      if (confirmCallback) { confirmCallback(); confirmCallback = null; }
    });

    // ---- 底部栏展开/收起收益详情（箭头触发） ----
    var bindExpandToggle = function (el) {
      if (el) el.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleSummaryExpand();
      });
    };
    bindExpandToggle(dom.bottomExpand);
    bindExpandToggle(dom.bottomExpandMg);

    // ---- 账户标签点击（支持主视图和管理页两个容器） ----
    var handleTabClick = function (e) {
      var tab = e.target.closest('.yjb_tab');
      if (!tab) return;
      var idx = parseInt(tab.getAttribute('data-idx'), 10);
      if (!isNaN(idx)) {
        applySelectedAccount(idx);
        state.expandedFund = null;
        renderAccountCard();
        renderAccountTabs('account_tabs');
        renderAccountTabs('account_tabs_manage');
        // ★ 切换 tab 时重新渲染基金列表（内部会根据 idx 控制卡片/列表显隐）
        renderFundList();
        renderBottomBar('bottom_bar');
        renderBottomBar('bottom_bar_manage');
      }
    };
    if (dom.accountTabs) dom.accountTabs.addEventListener('click', handleTabClick);
    var tabsManage = document.getElementById('account_tabs_manage');
    if (tabsManage) tabsManage.addEventListener('click', handleTabClick);

    // ---- 接收 background 消息 ----
    if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (msg) {
        if (msg && msg.type === 'DATA_UPDATED') {
          applyBackgroundDataUpdate(msg.payload || {});
          refreshAccountLineData(function () {
            renderDataViews();
            scheduleNextRefresh();
          });
        }
      });
    }
  }

  // =============================================
  // 初始化
  // =============================================

  function init() {
    bindEvents();
    loadThemeConfig();
    loadCachedUserProfile();
    loadRefreshConfig();

    // 加载数据
    loadIndexData();
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
