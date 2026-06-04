/**
 * 养基宝 Service Worker (MV3)
 * 功能：数据轮询、Badge 更新、Webhook 推送、消息通信
 */

// ========== 导入共享模块 ==========
importScripts('md5.min.js', 'api.js');

// ========== 全局状态 ==========
var globalData = null;  // 缓存的 index_data 数据

// ========== 工具函数 ==========

/**
 * 检查当前是否在交易时间内
 * 周一至周五 9:00-15:30
 */
function isTradingTime() {
  var now = new Date();
  var day = now.getDay();
  if (day === 0 || day === 6) return false; // 周末不推送
  var hours = now.getHours();
  var minutes = now.getMinutes();
  var time = hours * 100 + minutes;
  return time >= 900 && time <= 1530; // 9:00 - 15:30
}

/**
 * 检查是否有有效 token
 */
function hasValidToken() {
  return new Promise(function (resolve) {
    YjbAPI.token.get().then(function (token) {
      resolve(!!token);
    });
  });
}

function pick(obj, keys) {
  if (!obj) return undefined;
  for (var i = 0; i < keys.length; i++) {
    if (obj[keys[i]] !== undefined && obj[keys[i]] !== null) return obj[keys[i]];
  }
  return undefined;
}

function toNumber(val, fallback) {
  var num = Number(val);
  return isNaN(num) ? (fallback || 0) : num;
}

function formatSigned(num, digits) {
  num = toNumber(num, 0);
  return (num >= 0 ? '+' : '') + num.toFixed(digits === undefined ? 2 : digits);
}

function formatMoney(num) {
  return toNumber(num, 0).toFixed(2);
}

function trendIcon(num) {
  return toNumber(num, 0) >= 0 ? '🔴' : '🟢';
}

function getFundDisplayName(fund) {
  return pick(fund, ['short_name', 'shortName', 'fund_name', 'fundName', 'name', 'display_name']) || '未知基金';
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function atReportTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 22, 0, 0, 0);
}

function isWorkday(date) {
  var day = date.getDay();
  return day >= 1 && day <= 5;
}

function addDays(date, days) {
  var next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getNextDailyReportTime(now) {
  var target = atReportTime(now);
  if (target <= now) target = atReportTime(addDays(now, 1));
  return target;
}

function getNextWeeklyReportTime(now) {
  var cursor = startOfDay(now);
  for (var i = 0; i < 14; i++) {
    if (cursor.getDay() === 5) {
      var target = atReportTime(cursor);
      if (target > now) return target;
    }
    cursor = addDays(cursor, 1);
  }
  return atReportTime(addDays(now, 7));
}

function getLastWorkdayOfMonth(year, month) {
  var cursor = new Date(year, month + 1, 0);
  while (!isWorkday(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

function getNextMonthlyReportTime(now) {
  var year = now.getFullYear();
  var month = now.getMonth();
  for (var i = 0; i < 3; i++) {
    var targetDay = getLastWorkdayOfMonth(year, month + i);
    var target = atReportTime(targetDay);
    if (target > now) return target;
  }
  return atReportTime(getLastWorkdayOfMonth(year, month + 1));
}

// ========== 数据轮询 ==========

/**
 * 执行数据轮询：获取首页数据并更新 badge
 */
function doPoll() {
  hasValidToken().then(function (valid) {
    if (!valid) return;

    // 并行请求 index_data 和 account_collect
    Promise.all([
      YjbAPI.fundHold().catch(function (e) { console.warn('[YJB] fund_hold failed:', e); return null; }),
      YjbAPI.indexData().catch(function (e) { console.warn('[YJB] index_data 失败:', e); return null; }),
      YjbAPI.accountCollect().catch(function (e) { console.warn('[YJB] account_collect 失败:', e); return null; })
    ]).then(function (results) {
      var fundRes = results[0];
      var indexRes = results[1];
      var accRes = results[2];
      var funds = null;
      var nextData = Object.assign({}, globalData || {});

      // 合并 index_data
      if (indexRes && indexRes.data) {
        nextData.index_data = indexRes.data;
      }

      // 合并 account_collect（包含 today_income、today_income_rate 等摘要数据）
      if (accRes && accRes.data) {
        nextData = Object.assign(nextData, accRes.data);
      }

      if (fundRes && fundRes.data) {
        funds = normalizeFundList(fundRes.data);
        nextData.fund_list = funds;
        attachFundsToAccounts(nextData, funds);
      }

      globalData = nextData;
      updateBadge(globalData);

      // 通知 popup 刷新（如果打开的话）
      try {
        var payload = Object.assign({}, indexRes && indexRes.data ? { index_data: indexRes.data } : {},
          accRes && accRes.data ? accRes.data : {});
        if (funds !== null) {
          payload.fund_list = funds;
          attachFundsToAccounts(payload, funds);
        }
        chrome.runtime.sendMessage({
          type: 'DATA_UPDATED',
          payload: payload
        }).catch(function () {});
      } catch (e) {}
    }).catch(function (err) {
      console.error('[YJB] 轮询失败:', err.message);
    });
  });
}

/**
 * 更新扩展图标上的 Badge
 */
function updateBadge(data) {
  if (!data) return;

  var todayIncome = data.today_income || 0;
  var incomeRate = data.today_income_rate || 0;

  // 格式化显示文本
  var text = '';
  if (Math.abs(todayIncome) >= 10000) {
    text = (todayIncome / 10000).toFixed(1) + 'w';
  } else if (todayIncome !== 0) {
    // 显示收益金额，四舍五入到整数或1位小数
    var abs = Math.abs(todayIncome);
    if (abs >= 1000) {
      text = (todayIncome / 1000).toFixed(1) + 'k';
    } else {
      text = todayIncome.toFixed(todayIncome % 1 === 0 ? 0 : 1);
    }
  }

  // 颜色：红涨绿跌（中国股市惯例）
  var color = todayIncome >= 0 ? '#fc4e50' : '#07b360';

  chrome.action.setBadgeText({ text: text });
  chrome.action.setBadgeBackgroundColor({ color: color });
  chrome.action.setTitle({
    title: '今日收益: ' + (todayIncome >= 0 ? '+' : '') + todayIncome.toFixed(2) +
      ' (' + (incomeRate >= 0 ? '+' : '') + incomeRate.toFixed(2) + '%)'
  });
}

// ========== Webhook 推送 ==========

/**
 * 发送企业微信 Webhook 推送
 */
function sendWebhook(options) {
  options = options || {};
  chrome.storage.local.get(
    ['webhookUrl', 'webhookEnabled', 'lastPushTime', 'webhookInterval', 'webhookTimedEnabled'],
    function (result) {
      if (!result.webhookEnabled || !result.webhookUrl) return;
      if (options.kind === 'timer' && result.webhookTimedEnabled === false) return;

      var interval = (result.webhookInterval || 5) * 60 * 1000;
      if (options.kind === 'timer' && !options.force && result.lastPushTime && Date.now() - result.lastPushTime < interval) return;
      if (options.kind === 'timer' && !options.force && !isTradingTime()) return;
      sendWebhookWithFreshData(result.webhookUrl, function (payload) {
        if (payload && payload.ok === false) {
          if (options.callback) options.callback(payload);
          return;
        }
        if (!options.skipLastPushTime) chrome.storage.local.set({ lastPushTime: Date.now() });
        if (options.callback) options.callback({ ok: true });
      }, options);
    }
  );
}

function getStorage(keys) {
  return new Promise(function (resolve) {
    chrome.storage.local.get(keys, resolve);
  });
}

function normalizePeriodTestDateType(dateType) {
  dateType = String(dateType || 'day').trim();
  return dateType || 'day';
}

function getIncomeLineAccountIds(data) {
  var accounts = data && data.account_data;
  if (!Array.isArray(accounts)) return [];
  return accounts.map(function (acc) {
    return acc && acc.account_id;
  }).filter(function (accountId) {
    return accountId !== undefined && accountId !== null && String(accountId) !== '';
  });
}

function buildIncomeLineEndpoint(accountIds, dateType) {
  var params = accountIds.map(function (accountId) {
    return 'account_ids[]=' + encodeURIComponent(accountId);
  });
  params.push('date_type=' + encodeURIComponent(dateType));
  return '/income_line_data?' + params.join('&');
}

function summarizeIncomeLineResponse(response) {
  var data = response && response.data !== undefined ? response.data : response;
  var summary = {
    response_keys: response && typeof response === 'object' ? Object.keys(response) : [],
    data_type: Array.isArray(data) ? 'array' : typeof data,
    account_keys: [],
    accounts: {}
  };

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    summary.account_keys = Object.keys(data);
    summary.account_keys.forEach(function (accountId) {
      var row = data[accountId];
      var lineList = row && row.line_list;
      summary.accounts[accountId] = {
        keys: row && typeof row === 'object' ? Object.keys(row) : [],
        line_list_length: Array.isArray(lineList) ? lineList.length : null,
        first_line: Array.isArray(lineList) && lineList.length ? lineList[0] : null,
        last_line: Array.isArray(lineList) && lineList.length ? lineList[lineList.length - 1] : null
      };
    });
  }

  return summary;
}

function testPeriodData(dateType) {
  dateType = normalizePeriodTestDateType(dateType);
  return YjbAPI.accountCollect().then(function (accountRes) {
    var accountData = accountRes && accountRes.data;
    var accountIds = getIncomeLineAccountIds(accountData);
    if (!accountIds.length) {
      throw new Error('account_collect.data.account_data[].account_id 为空');
    }

    var endpoint = buildIncomeLineEndpoint(accountIds, dateType);
    return YjbAPI._request(endpoint).then(function (response) {
      return {
        ok: true,
        date_type: dateType,
        endpoint: endpoint,
        account_ids: accountIds,
        response_summary: summarizeIncomeLineResponse(response),
        raw_response: response
      };
    });
  }).catch(function (err) {
    return {
      ok: false,
      date_type: dateType,
      error: err && err.message ? err.message : String(err)
    };
  });
}

function getReportPeriodDateType(kind) {
  if (kind === 'weekly') return 'week';
  if (kind === 'monthly') return 'month';
  return '';
}

function getReportPeriodTitle(dateType) {
  if (dateType === 'week') return '本周数据';
  if (dateType === 'month') return '本月数据';
  return '周期数据';
}

function getAccountTitleMap(data) {
  var map = {};
  var accounts = data && data.account_data;
  if (!Array.isArray(accounts)) return map;
  accounts.forEach(function (acc, idx) {
    if (!acc || acc.account_id === undefined || acc.account_id === null) return;
    map[String(acc.account_id)] = acc.title || ('账户 ' + (idx + 1));
  });
  return map;
}

function toPeriodLine(line) {
  return {
    time: line ? line.time : '',
    rate: toNumber(line ? line.rate : 0, 0),
    total_income: toNumber(line ? line.total_income : 0, 0),
    income: toNumber(line ? line.income : 0, 0)
  };
}

function buildReportPeriodData(dateType, endpoint, accountIds, response, data) {
  var rawData = response && response.data;
  var titleMap = getAccountTitleMap(data);
  var accountRows = [];
  var dateSeen = {};
  var summary = {
    income: 0,
    income_sum: 0,
    rate: null,
    start_time: '',
    end_time: '',
    days: 0
  };

  accountIds.forEach(function (accountId) {
    var key = String(accountId);
    var row = rawData && rawData[key];
    var rawLines = row && Array.isArray(row.line_list) ? row.line_list : [];
    var lines = rawLines.map(toPeriodLine);
    var firstLine = lines.length ? lines[0] : null;
    var lastLine = lines.length ? lines[lines.length - 1] : null;
    var incomeSum = lines.reduce(function (total, line) {
      if (line.time) dateSeen[line.time] = true;
      return total + line.income;
    }, 0);
    var accountIncome = lastLine ? lastLine.total_income : incomeSum;
    var accountRate = lastLine ? lastLine.rate : null;

    if (firstLine && (!summary.start_time || firstLine.time < summary.start_time)) summary.start_time = firstLine.time;
    if (lastLine && (!summary.end_time || lastLine.time > summary.end_time)) summary.end_time = lastLine.time;

    summary.income += accountIncome;
    summary.income_sum += incomeSum;

    accountRows.push({
      account_id: accountId,
      title: titleMap[key] || ('账户 ' + key),
      line_list: lines,
      start_time: firstLine ? firstLine.time : '',
      end_time: lastLine ? lastLine.time : '',
      income: accountIncome,
      income_sum: incomeSum,
      rate: accountRate
    });
  });

  var dateKeys = Object.keys(dateSeen);
  summary.days = dateKeys.length;
  if (accountRows.length === 1) summary.rate = accountRows[0].rate;

  return {
    date_type: dateType,
    title: getReportPeriodTitle(dateType),
    endpoint: endpoint,
    account_ids: accountIds,
    accounts: accountRows,
    summary: summary
  };
}

function fetchReportPeriodData(kind, data) {
  var dateType = getReportPeriodDateType(kind);
  if (!dateType) return Promise.resolve(null);

  var accountIds = getIncomeLineAccountIds(data);
  if (!accountIds.length) {
    return Promise.resolve({
      date_type: dateType,
      title: getReportPeriodTitle(dateType),
      error: 'account_data[].account_id 为空'
    });
  }

  var endpoint = buildIncomeLineEndpoint(accountIds, dateType);
  return YjbAPI._request(endpoint).then(function (response) {
    return buildReportPeriodData(dateType, endpoint, accountIds, response, data);
  });
}

function refreshWebhookData() {
  return Promise.all([
    YjbAPI.indexData().catch(function () { return null; }),
    YjbAPI.accountCollect().catch(function () { return null; }),
    YjbAPI.fundHold().catch(function () { return null; })
  ]).then(function (results) {
    var indexRes = results[0];
    var accRes = results[1];
    var fundRes = results[2];
    var nextData = Object.assign({}, globalData || {});

    if (indexRes && indexRes.data) nextData.index_data = indexRes.data;

    if (accRes && accRes.data) {
      nextData = Object.assign(nextData, accRes.data);
    }

    if (fundRes && fundRes.data) {
      var funds = normalizeFundList(fundRes.data);
      if (funds.length) {
        nextData.fund_list = funds;
        attachFundsToAccounts(nextData, funds);
      }
    }

    globalData = nextData;
    updateBadge(globalData);
    return globalData;
  });
}

function normalizeFundList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  var list = null;
  if (data.data && Array.isArray(data.data)) list = data.data;
  else if (data.list && Array.isArray(data.list)) list = data.list;
  else list = pick(data, ['fund_list', 'fundList', 'funds', 'hold_list', 'holdList', 'items']);

  return Array.isArray(list) ? list : [];
}

function attachFundsToAccounts(data, funds) {
  var accounts = pick(data, ['account_data', 'accountData', 'accounts', 'list']);
  if (!Array.isArray(accounts) || !accounts.length || !funds.length) return;

  if (accounts.length === 1) {
    accounts[0].fund_list = funds;
    return;
  }

  accounts.forEach(function (acc) {
    var accId = pick(acc, ['account_id', 'accountId', 'id']);
    acc.fund_list = funds.filter(function (fund) {
      var fundAccId = pick(fund, ['account_id', 'accountId']);
      return accId !== undefined && fundAccId !== undefined && String(fundAccId) === String(accId);
    });
  });

  var assigned = [];
  accounts.forEach(function (acc) {
    assigned = assigned.concat(acc.fund_list || []);
  });
  var unassigned = funds.filter(function (fund) { return assigned.indexOf(fund) === -1; });
  if (unassigned.length) accounts[0].fund_list = (accounts[0].fund_list || []).concat(unassigned);
}

function testWebhook(kind) {
  kind = normalizeWebhookKind(kind);
  return getStorage(['webhookUrl']).then(function (result) {
    if (!result.webhookUrl) {
      return { ok: false, error: '请先填写 Webhook 地址' };
    }
    return refreshWebhookData().then(function () {
      if (!globalData) {
        return { ok: false, error: '暂无真实数据，请先打开弹窗并手动刷新一次' };
      }

      return doWebhookPush(result.webhookUrl, null, { kind: kind, force: true, skipLastPushTime: true });
    });
  });
}

function sendWebhookWithFreshData(url, callback, options) {
  refreshWebhookData().then(function () {
    if (!globalData) {
      if (callback) callback({ ok: false, error: '暂无真实数据' });
      return;
    }
    doWebhookPush(url, callback, options);
  }).catch(function (err) {
    if (!globalData) {
      if (callback) callback({ ok: false, error: err.message });
      return;
    }
    doWebhookPush(url, callback, options);
  });
}

function collectFundsForPush(data) {
  var funds = [];
  var seen = {};
  var accounts = pick(data, ['account_data', 'accountData', 'accounts', 'list']) || [];

  if (Array.isArray(accounts)) {
    accounts.forEach(function (acc) {
      var list = pick(acc, ['fund_list', 'fundList', 'funds', 'hold_list', 'holdList', 'list']) || [];
      if (Array.isArray(list)) {
        list.forEach(function (fund) {
          var code = pick(fund, ['code', 'fund_code', 'fundCode']) || '';
          var key = code || JSON.stringify(fund).slice(0, 80);
          if (!seen[key]) {
            seen[key] = true;
            funds.push(fund);
          }
        });
      }
    });
  }

  if (!funds.length) {
    var topLevelFunds = normalizeFundList(data);
    topLevelFunds.forEach(function (fund) {
      var code = pick(fund, ['code', 'fund_code', 'fundCode']) || '';
      var key = code || JSON.stringify(fund).slice(0, 80);
      if (!seen[key]) {
        seen[key] = true;
        funds.push(fund);
      }
    });
  }

  return funds;
}

function getFundTodayStats(fund) {
  var nvInfo = fund.nv_info || null;
  var income;
  var rate;

  if (nvInfo) {
    var share = toNumber(pick(fund, ['hold_share', 'holdShare']), 0);
    var zde = toNumber(nvInfo.zde, 0);
    income = share * zde;
    var rzzlVal = toNumber(nvInfo.rzzl, NaN);
    rate = isNaN(rzzlVal) ? toNumber(nvInfo.vgszzl, 0) : rzzlVal;
  } else {
    income = pick(fund, ['today_income', 'todayIncome', 'profit', 'hold_earn', 'holdIncome']);
    rate = pick(fund, ['today_income_rate', 'todayIncomeRate', 'rate', 'net_day', 'netDay']);
  }

  // 关联涨幅：从 sector_info 获取
  var sectorInfo = fund.sector_info || null;
  var sectorName = sectorInfo ? (sectorInfo.name || '') : '';
  var sectorRatio = sectorInfo ? toNumber(sectorInfo.ratio, NaN) : NaN;

  // 判断 updated_at 是否是今天
  var updatedToday = false;
  var updatedAt = fund.updated_at || '';
  if (updatedAt) {
    var d = new Date(updatedAt);
    var now = new Date();
    updatedToday = d.getFullYear() === now.getFullYear() &&
                   d.getMonth() === now.getMonth() &&
                   d.getDate() === now.getDate();
  }

  // 如果 updated_at 不是今天，使用关联涨幅替代今日涨幅
  var displayRate = updatedToday ? toNumber(rate, 0) : (isNaN(sectorRatio) ? 0 : sectorRatio);

  return {
    income: toNumber(income, 0),
    rate: toNumber(rate, 0),
    displayRate: displayRate,
    sectorName: sectorName,
    sectorRatio: sectorRatio,
    updatedToday: updatedToday
  };
}

function sortFundsForPush(funds) {
  return funds.slice().sort(function (a, b) {
    return Math.abs(getFundTodayStats(b).income) - Math.abs(getFundTodayStats(a).income);
  });
}

/**
 * 构造并发送 Webhook 消息体
 */
function getAccountSummary(data) {
  var accounts = pick(data, ['account_data', 'accountData', 'accounts', 'list']) || [];
  var up = 0;
  var down = 0;
  if (Array.isArray(accounts)) {
    accounts.forEach(function (acc) {
      up += toNumber(acc.up, 0);
      down += toNumber(acc.down, 0);
    });
  }
  return { accounts: accounts, up: up, down: down };
}

function getReportTitle(kind) {
  if (kind === 'daily') return '养基宝日报';
  if (kind === 'weekly') return '养基宝周报';
  if (kind === 'monthly') return '养基宝月报';
  if (kind === 'test') return '养基宝测试推送';
  return '养基宝定时提醒';
}

function normalizeWebhookKind(kind) {
  return ['test', 'timer', 'daily', 'weekly', 'monthly'].indexOf(kind) !== -1 ? kind : 'test';
}

function doWebhookPush(url, callback, options) {
  options = options || {};
  var d = globalData || {};
  var income = d.today_income || 0;
  var rate = d.today_income_rate || 0;
  var assets = d.assets_collect || 0;
  var kind = options.kind || 'report';
  var concise = kind === 'timer';
  var accountSummary = getAccountSummary(d);
  var funds = sortFundsForPush(collectFundsForPush(d));
  var model = {
    data: d,
    kind: kind,
    concise: concise,
    income: income,
    rate: rate,
    assets: assets,
    accountSummary: accountSummary,
    funds: funds,
    updatedAt: new Date().toLocaleString()
  };

  return fetchReportPeriodData(kind, d)
    .then(function (periodData) {
      if (periodData) model.periodData = periodData;
      return pushWebhookModel(url, callback, model);
    })
    .catch(function (err) {
      if (getReportPeriodDateType(kind)) {
        model.periodDataError = err && err.message ? err.message : String(err);
      }
      return pushWebhookModel(url, callback, model);
    });
}

function pushWebhookModel(url, callback, model) {
  var markdown = buildWebhookMarkdown(model);
  return renderWebhookImage(model)
    .then(function (image) {
      return sendImage(url, image, callback);
    })
    .catch(function (err) {
      console.warn('[YJB] 图片推送失败，降级为 Markdown:', err && err.message ? err.message : err);
      return sendMarkdown(url, markdown, callback);
    });
}

function buildWebhookMarkdown(model) {
  var md = '## ' + getReportTitle(model.kind) + '\n\n';
  md += '> ' + trendIcon(model.income) + ' 今日收益：**' + formatSigned(model.income, 2) + ' 元**（' + formatSigned(model.rate, 2) + '%）\n';

  if (model.concise) {
    return md;
  }

  md += '> 总资产：**' + formatMoney(model.assets) + ' 元**\n';

  if (model.accountSummary.up || model.accountSummary.down) {
    md += '> 涨跌分布：涨 ' + model.accountSummary.up + ' 支 / 跌 ' + model.accountSummary.down + ' 支\n';
  }
  md += '> 更新时间：' + model.updatedAt + '\n';

  md = appendPeriodMarkdown(md, model);

  if (model.accountSummary.accounts && model.accountSummary.accounts.length) {
    md += '\n### 账户表现\n';
    model.accountSummary.accounts.forEach(function (acc, idx) {
      var accTitle = getAccountTitle(acc, idx);
      var accIncome = toNumber(acc.today_income, 0);
      var accRate = toNumber(acc.today_income_rate, 0);
      md += (idx + 1) + '. ' + trendIcon(accIncome) + ' **' + accTitle + '**\n';
      md += '   资产 ' + formatMoney(acc.account_assets) + ' 元 | 今日 ' + formatSigned(accIncome, 2) + ' 元（' + formatSigned(accRate, 2) + '%）\n';
      md += '   涨 ' + (acc.up || 0) + ' 支 / 跌 ' + (acc.down || 0) + ' 支 | 持有收益 ' + formatSigned(acc.hold_income || 0, 2) + ' 元\n';
    });
  }

  md += '\n### 基金影响排行\n';
  if (model.funds.length) {
    model.funds.slice(0, 10).forEach(function (fund, idx) {
      var stats = getFundTodayStats(fund);
      var fName = getFundDisplayName(fund);
      var fCode = pick(fund, ['code', 'fund_code', 'fundCode']) || '';
      var rateLabel = getFundRateLabel(stats);
      md += (idx + 1) + '. ' + trendIcon(stats.income) + ' **' + fName + '**' + (fCode ? ' `' + fCode + '`' : '') + '\n';
      md += '   ' + rateLabel + ' ' + formatSigned(stats.displayRate, 2) + '% | 今日收益 ' + formatSigned(stats.income, 2) + ' 元\n';
    });
    if (model.funds.length > 10) {
      md += '- 其余 ' + (model.funds.length - 10) + ' 只基金未展示\n';
    }
  } else {
    md += '- 暂无基金明细\n';
  }
  return md;
}

function appendPeriodMarkdown(md, model) {
  var period = model.periodData;
  if (!period && !model.periodDataError) return md;

  md += '\n### ' + (period && period.title ? period.title : getReportPeriodTitle(getReportPeriodDateType(model.kind))) + '\n';
  if (model.periodDataError || period.error) {
    md += '- 获取失败：' + (model.periodDataError || period.error) + '\n';
    return md;
  }

  var summary = period.summary || {};
  md += '- 区间：' + getPeriodRangeLabel(summary) + '\n';
  md += '- 周期收益：' + formatSigned(summary.income, 2) + ' 元';
  if (summary.rate !== null && summary.rate !== undefined) {
    md += '（' + formatSigned(summary.rate, 2) + '%）';
  }
  md += '\n';

  if (period.accounts && period.accounts.length) {
    period.accounts.slice(0, 5).forEach(function (acc, idx) {
      md += (idx + 1) + '. **' + acc.title + '**：' + formatSigned(acc.income, 2) + ' 元';
      if (acc.rate !== null && acc.rate !== undefined) md += '，' + formatSigned(acc.rate, 2) + '%';
      md += '\n';
    });
  }
  return md;
}

function getPeriodRangeLabel(summary) {
  if (!summary) return '--';
  if (summary.start_time && summary.end_time && summary.start_time !== summary.end_time) {
    return summary.start_time + ' 至 ' + summary.end_time;
  }
  return summary.start_time || summary.end_time || '--';
}

function getAccountTitle(acc, idx) {
  return pick(acc, ['title', 'name', 'account_name', 'accountName', 'platform']) || ('账户 ' + (idx + 1));
}

function getFundRateLabel(stats) {
  return stats.updatedToday ? '今日涨幅' : ('关联' + (stats.sectorName ? ' ' + stats.sectorName : '涨幅'));
}

function trendColor(num) {
  return toNumber(num, 0) >= 0 ? '#d94b43' : '#169b62';
}

function drawRoundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function truncateText(ctx, text, maxWidth) {
  text = String(text || '');
  if (ctx.measureText(text).width <= maxWidth) return text;
  var ellipsis = '...';
  while (text.length && ctx.measureText(text + ellipsis).width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + ellipsis;
}

function fitCanvasFontSize(ctx, text, maxWidth, maxSize, minSize, weight, family) {
  var size = maxSize;
  while (size > minSize) {
    ctx.font = weight + ' ' + size + 'px ' + family;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return minSize;
}

function drawTrendDot(ctx, x, y, value) {
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = trendColor(value);
  ctx.fill();
}

function drawSectionTitle(ctx, title, x, y) {
  ctx.font = '700 22px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = '#111827';
  ctx.fillText(title, x, y);
}

function formatPeriodRate(summary) {
  if (!summary || summary.rate === null || summary.rate === undefined) return '--';
  return formatSigned(summary.rate, 2) + '%';
}

function drawPeriodSummary(ctx, model, x, y, w) {
  var period = model.periodData;
  var title = period && period.title ? period.title : getReportPeriodTitle(getReportPeriodDateType(model.kind));
  drawSectionTitle(ctx, title, x + 8, y);
  y += 22;
  drawRoundRect(ctx, x, y, w, 78, 16, '#ffffff', '#e6ebf2');

  if (model.periodDataError || (period && period.error)) {
    ctx.font = '400 16px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText('周期数据获取失败：' + truncateText(ctx, model.periodDataError || period.error, 520), x + 24, y + 45);
    return y + 106;
  }

  var summary = period.summary || {};
  ctx.font = '400 14px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText('区间', x + 24, y + 28);
  ctx.fillText('周期收益', x + 326, y + 28);
  ctx.fillText('周期涨幅', x + 608, y + 28);

  ctx.font = '700 18px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = '#111827';
  ctx.fillText(truncateText(ctx, getPeriodRangeLabel(summary), 250), x + 24, y + 54);
  ctx.fillStyle = trendColor(summary.income);
  ctx.fillText(formatSigned(summary.income, 2) + ' 元', x + 326, y + 54);
  ctx.fillText(formatPeriodRate(summary), x + 608, y + 54);

  return y + 106;
}

function renderTimerWebhookImage(model) {
  if (typeof OffscreenCanvas === 'undefined') {
    return Promise.reject(new Error('OffscreenCanvas 不可用'));
  }

  var width = 900;
  var height = 430;
  var canvas = new OffscreenCanvas(width, height);
  var ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas 2D context 不可用'));

  ctx.fillStyle = '#f3f5f9';
  ctx.fillRect(0, 0, width, height);

  var rising = toNumber(model.income, 0) >= 0;
  var gradient = ctx.createLinearGradient(30, 28, width - 30, height - 28);
  if (rising) {
    gradient.addColorStop(0, '#8b1d1d');
    gradient.addColorStop(0.56, '#dc2626');
    gradient.addColorStop(1, '#f97373');
  } else {
    gradient.addColorStop(0, '#064e3b');
    gradient.addColorStop(0.56, '#059669');
    gradient.addColorStop(1, '#34d399');
  }
  drawRoundRect(ctx, 28, 28, width - 56, height - 56, 28, gradient);

  ctx.font = '700 32px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('养基宝定时提醒', 64, 88);
  ctx.font = '400 17px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(model.updatedAt, 64, 122);

  drawRoundRect(ctx, 64, 166, width - 128, 178, 24, 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.24)');

  ctx.font = '400 16px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.70)';
  ctx.fillText('今日收益', 96, 210);
  var incomeText = formatSigned(model.income, 2);
  var incomeFamily = '"DIN Alternate", "Microsoft YaHei", Arial, sans-serif';
  var incomeFontSize = fitCanvasFontSize(ctx, incomeText, width - 210, 88, 52, '700', incomeFamily);
  ctx.font = '700 ' + incomeFontSize + 'px ' + incomeFamily;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(incomeText, 94, 292);
  ctx.font = '500 24px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillText('元', 98, 324);

  if (!canvas.convertToBlob) {
    return Promise.reject(new Error('convertToBlob 不可用'));
  }
  return canvas.convertToBlob({ type: 'image/png' })
    .then(function (blob) { return blob.arrayBuffer(); })
    .then(function (buffer) {
      if (buffer.byteLength > 2 * 1024 * 1024) {
        throw new Error('图片超过 2MB');
      }
      return {
        base64: arrayBufferToBase64(buffer),
        md5: md5(buffer)
      };
    });
}

function renderWebhookImage(model) {
  if (model.concise) {
    return renderTimerWebhookImage(model);
  }

  if (typeof OffscreenCanvas === 'undefined') {
    return Promise.reject(new Error('OffscreenCanvas 不可用'));
  }

  var width = 900;
  var accounts = model.concise ? [] : (Array.isArray(model.accountSummary.accounts) ? model.accountSummary.accounts.slice(0, 4) : []);
  var fundLimit = model.concise ? 5 : 8;
  var funds = model.funds.slice(0, fundLimit);
  var fundRows = Math.max(funds.length, 1);
  var height = 330 + fundRows * 72 + 64;
  var hasPeriodBlock = !!(model.periodData || model.periodDataError);
  if (hasPeriodBlock) height += 126;
  if (accounts.length) height += 58 + accounts.length * 76;
  if (height < 620) height = 620;

  var canvas = new OffscreenCanvas(width, height);
  var ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas 2D context 不可用'));

  ctx.fillStyle = '#f3f5f9';
  ctx.fillRect(0, 0, width, height);

  var headerGradient = ctx.createLinearGradient(24, 24, width - 24, 210);
  headerGradient.addColorStop(0, '#141a45');
  headerGradient.addColorStop(1, '#2f5fce');
  drawRoundRect(ctx, 24, 24, width - 48, 210, 26, headerGradient);

  ctx.font = '700 34px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(getReportTitle(model.kind), 54, 74);
  ctx.font = '400 16px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.74)';
  ctx.fillText(model.updatedAt, 54, 104);

  ctx.font = '700 46px "DIN Alternate", "Microsoft YaHei", Arial, sans-serif';
  ctx.fillStyle = model.income >= 0 ? '#ffdfdf' : '#d8f7e7';
  ctx.fillText(formatSigned(model.income, 2) + ' 元', 54, 164);
  ctx.font = '500 18px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.84)';
  ctx.fillText('今日收益率 ' + formatSigned(model.rate, 2) + '%', 56, 196);

  drawRoundRect(ctx, 590, 58, 276, 58, 16, 'rgba(255,255,255,0.16)');
  drawRoundRect(ctx, 590, 134, 276, 58, 16, 'rgba(255,255,255,0.16)');
  ctx.font = '400 15px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.70)';
  ctx.fillText('总资产', 614, 82);
  ctx.fillText('涨跌分布', 614, 158);
  ctx.font = '700 24px "DIN Alternate", "Microsoft YaHei", Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(formatMoney(model.assets) + ' 元', 614, 106);
  ctx.fillText('涨 ' + model.accountSummary.up + ' / 跌 ' + model.accountSummary.down, 614, 182);

  var y = 274;
  if (hasPeriodBlock) {
    y = drawPeriodSummary(ctx, model, 36, y, width - 72);
  }

  if (accounts.length) {
    drawSectionTitle(ctx, '账户表现', 44, y);
    y += 22;
    accounts.forEach(function (acc, idx) {
      var accIncome = toNumber(acc.today_income, 0);
      var accRate = toNumber(acc.today_income_rate, 0);
      drawRoundRect(ctx, 36, y, width - 72, 62, 16, '#ffffff', '#e6ebf2');
      drawTrendDot(ctx, 62, y + 31, accIncome);
      ctx.font = '700 18px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
      ctx.fillStyle = '#111827';
      ctx.fillText(truncateText(ctx, getAccountTitle(acc, idx), 260), 80, y + 27);
      ctx.font = '400 14px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText('资产 ' + formatMoney(acc.account_assets) + ' 元', 80, y + 49);
      ctx.font = '700 18px "DIN Alternate", "Microsoft YaHei", Arial, sans-serif';
      ctx.fillStyle = trendColor(accIncome);
      ctx.fillText(formatSigned(accIncome, 2) + ' 元', 510, y + 29);
      ctx.font = '400 14px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText(formatSigned(accRate, 2) + '% | 涨 ' + (acc.up || 0) + ' / 跌 ' + (acc.down || 0), 510, y + 50);
      y += 76;
    });
    y += 14;
  }

  drawSectionTitle(ctx, model.concise ? '今日影响 Top 5' : '基金影响排行', 44, y);
  y += 22;
  if (funds.length) {
    funds.forEach(function (fund, idx) {
      var stats = getFundTodayStats(fund);
      var fName = getFundDisplayName(fund);
      var fCode = pick(fund, ['code', 'fund_code', 'fundCode']) || '';
      var rateLabel = getFundRateLabel(stats);
      drawRoundRect(ctx, 36, y, width - 72, 60, 16, '#ffffff', '#e6ebf2');
      ctx.font = '700 15px "DIN Alternate", Arial, sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.fillText(String(idx + 1).padStart(2, '0'), 58, y + 35);
      drawTrendDot(ctx, 96, y + 30, stats.income);
      ctx.font = '700 17px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
      ctx.fillStyle = '#111827';
      ctx.fillText(truncateText(ctx, fName, 330), 114, y + 27);
      ctx.font = '400 13px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText((fCode ? fCode + ' · ' : '') + rateLabel + ' ' + formatSigned(stats.displayRate, 2) + '%', 114, y + 49);
      ctx.font = '700 18px "DIN Alternate", "Microsoft YaHei", Arial, sans-serif';
      ctx.fillStyle = trendColor(stats.income);
      ctx.fillText(formatSigned(stats.income, 2) + ' 元', 692, y + 36);
      y += 72;
    });
  } else {
    drawRoundRect(ctx, 36, y, width - 72, 60, 16, '#ffffff', '#e6ebf2');
    ctx.font = '400 16px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText('暂无基金明细', 60, y + 36);
  }

  ctx.font = '400 13px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.fillText('由养基宝自动生成', 44, height - 28);

  if (!canvas.convertToBlob) {
    return Promise.reject(new Error('convertToBlob 不可用'));
  }
  return canvas.convertToBlob({ type: 'image/png' })
    .then(function (blob) { return blob.arrayBuffer(); })
    .then(function (buffer) {
      if (buffer.byteLength > 2 * 1024 * 1024) {
        throw new Error('图片超过 2MB');
      }
      return {
        base64: arrayBufferToBase64(buffer),
        md5: md5(buffer)
      };
    });
}

function arrayBufferToBase64(buffer) {
  if (typeof btoa === 'undefined') throw new Error('btoa 不可用');
  var bytes = new Uint8Array(buffer);
  var binary = '';
  var chunkSize = 0x8000;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function sendImage(url, image, callback) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'image',
      image: {
        base64: image.base64,
        md5: image.md5
      }
    })
  }).then(function (res) {
    if (!res.ok) throw new Error('Webhook 返回状态 ' + res.status);
    console.log('[YJB] Webhook 图片推送成功');
    var payload = { ok: true };
    if (callback) callback(payload);
    return payload;
  });
}

function sendMarkdown(url, md, callback) {
  // 发送请求
  var pushPromise = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content: md }
    })
  }).then(function (res) {
    var payload;
    if (res.ok) {
      console.log('[YJB] Webhook 推送成功');
      payload = { ok: true };
    } else {
      console.warn('[YJB] Webhook 返回状态:', res.status);
      payload = { ok: false, error: 'Webhook 返回状态 ' + res.status };
    }
    if (callback) callback(payload);
    return payload;
  }).catch(function (err) {
    var payload = { ok: false, error: err.message };
    console.error('[YJB] Webhook 推送失败:', err.message);
    if (callback) callback(payload);
    return payload;
  });

  return pushPromise;
}

// ========== Alarm 管理 ==========

var WEBHOOK_ALARMS = ['webhook', 'webhook_daily', 'webhook_weekly', 'webhook_monthly'];

function clearWebhookAlarms(callback) {
  var pending = WEBHOOK_ALARMS.length;
  WEBHOOK_ALARMS.forEach(function (name) {
    chrome.alarms.clear(name, function () {
      pending--;
      if (pending === 0 && callback) callback();
    });
  });
}

function scheduleWebhookAlarms(config) {
  config = config || {};
  clearWebhookAlarms(function () {
    if (!config.enabled) return;

    if (config.timedEnabled !== false) {
      var minutes = Math.max(1, Math.ceil((config.interval || 5) / 1));
      chrome.alarms.create('webhook', { periodInMinutes: Math.max(1, Math.floor(minutes)) });
    }

    if (config.dailyEnabled) {
      chrome.alarms.create('webhook_daily', { when: getNextDailyReportTime(new Date()).getTime() });
    }
    if (config.weeklyEnabled) {
      chrome.alarms.create('webhook_weekly', { when: getNextWeeklyReportTime(new Date()).getTime() });
    }
    if (config.monthlyEnabled) {
      chrome.alarms.create('webhook_monthly', { when: getNextMonthlyReportTime(new Date()).getTime() });
    }
  });
}

function loadWebhookAlarmConfig(callback) {
  chrome.storage.local.get([
    'webhookEnabled', 'webhookInterval', 'webhookTimedEnabled',
    'webhookDailyEnabled', 'webhookWeeklyEnabled', 'webhookMonthlyEnabled'
  ], function (result) {
    callback({
      enabled: result.webhookEnabled === true,
      interval: Math.max(1, parseInt(result.webhookInterval || '5', 10) || 5),
      timedEnabled: result.webhookTimedEnabled !== false,
      dailyEnabled: result.webhookDailyEnabled === true,
      weeklyEnabled: result.webhookWeeklyEnabled === true,
      monthlyEnabled: result.webhookMonthlyEnabled === true
    });
  });
}

function rescheduleReportAlarm(name) {
  loadWebhookAlarmConfig(function (config) {
    if (!config.enabled) return;
    if (name === 'webhook_daily' && config.dailyEnabled) {
      chrome.alarms.create(name, { when: getNextDailyReportTime(new Date()).getTime() });
    } else if (name === 'webhook_weekly' && config.weeklyEnabled) {
      chrome.alarms.create(name, { when: getNextWeeklyReportTime(new Date()).getTime() });
    } else if (name === 'webhook_monthly' && config.monthlyEnabled) {
      chrome.alarms.create(name, { when: getNextMonthlyReportTime(new Date()).getTime() });
    }
  });
}

/**
 * 创建定时任务
 */
function setupAlarms() {
  // 数据轮询：按用户配置间隔（默认开启，3分钟）
  chrome.storage.local.get(['refreshEnabled', 'refreshInterval'], function (result) {
    chrome.alarms.clear('poll', function () {
      if (result.refreshEnabled === false) return;
      var minutes = Math.max(1, parseInt(result.refreshInterval || '3', 10) || 3);
      chrome.alarms.create('poll', { periodInMinutes: minutes });
    });
  });

  loadWebhookAlarmConfig(scheduleWebhookAlarms);
}

// ========== 消息监听 ==========

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  switch (message.type) {
    case 'GET_GLOBAL_DATA':
      sendResponse(globalData);
      return false;

    case 'SET_GLOBAL_DATA':
      globalData = Object.assign({}, globalData || {}, message.payload || {});
      updateBadge(globalData);
      return false;

    case 'TRIGGER_POLL':
      doPoll();
      sendResponse({ ok: true });
      return false;

    case 'TRIGGER_WEBHOOK':
      sendWebhook();
      sendResponse({ ok: true });
      return false;

    case 'TEST_WEBHOOK':
      testWebhook(message.kind)
        .then(sendResponse)
        .catch(function (err) {
          sendResponse({ ok: false, error: err && err.message ? err.message : '测试推送失败' });
        });
      return true;

    case 'TEST_PERIOD_DATA':
      testPeriodData(message.dateType)
        .then(sendResponse)
        .catch(function (err) {
          sendResponse({ ok: false, error: err && err.message ? err.message : '收益接口测试失败' });
        });
      return true;

    case 'UPDATE_WEBHOOK_ALARM':
      scheduleWebhookAlarms({
        enabled: message.enabled === true,
        interval: Math.max(1, parseInt(message.interval || '5', 10) || 5),
        timedEnabled: message.timedEnabled !== false,
        dailyEnabled: message.dailyEnabled === true,
        weeklyEnabled: message.weeklyEnabled === true,
        monthlyEnabled: message.monthlyEnabled === true
      });
      sendResponse({ ok: true });
      return false;

    case 'UPDATE_REFRESH_ALARM':
      chrome.alarms.clear('poll', function () {
        if (message.enabled !== false) {
          var refreshInterval = Math.max(1, parseInt(message.interval || '3', 10) || 3);
          chrome.alarms.create('poll', { periodInMinutes: refreshInterval });
        }
        sendResponse({ ok: true });
      });
      return true;

    default:
      return false;
  }
});

// ========== 事件监听 ==========

// Alarm 触发
chrome.alarms.onAlarm.addListener(function (alarm) {
  try {
    if (alarm.name === 'poll') doPoll();
    else if (alarm.name === 'webhook') sendWebhook({ kind: 'timer' });
    else if (alarm.name === 'webhook_daily') {
      sendWebhook({ kind: 'daily', force: true, skipLastPushTime: true });
      rescheduleReportAlarm(alarm.name);
    } else if (alarm.name === 'webhook_weekly') {
      sendWebhook({ kind: 'weekly', force: true, skipLastPushTime: true });
      rescheduleReportAlarm(alarm.name);
    } else if (alarm.name === 'webhook_monthly') {
      sendWebhook({ kind: 'monthly', force: true, skipLastPushTime: true });
      rescheduleReportAlarm(alarm.name);
    }
  } catch (err) {
    console.error('[YJB] Alarm 处理错误:', err);
  }
});

// 扩展安装/更新
chrome.runtime.onInstalled.addListener(function (details) {
  console.log('[YJB] 扩展已安装/更新:', details.reason);
  setupAlarms();
  // 首次安装时立即轮询一次
  if (details.reason === 'install') {
    setTimeout(doPoll, 2000);
  }
});

// Service Worker 启动（浏览器启动等）
self.addEventListener('activate', function () {
  console.log('[YJB] Service Worker 已激活');
  // 确保 alarms 存在
  chrome.alarms.get('poll', function (alarm) {
    if (!alarm) setupAlarms();
  });
});

// 启动时也执行一次轮询
doPoll();
