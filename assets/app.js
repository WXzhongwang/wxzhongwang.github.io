/* zhongwang 的大数据宝典 - 多页面共享逻辑 */
(function () {
  var STACKS = ['Hadoop', 'Spark', 'Flink', 'Kafka', 'Hive', 'HBase', 'ClickHouse', 'Doris', '数据湖', '数仓与调度', '其他'];
  var TYPES = ['原理', '使用方法', '面试题', '架构方案', '核心代码'];
  var INTERVALS = [1, 3, 7, 15, 30]; // 艾宾浩斯复习间隔（天）
  var LS_PROGRESS = 'bdh_progress_v1';     // 对云端卡片的本地覆盖（复习进度）
  var LS_CUSTOM = 'bdh_custom_v1';         // 本地新增卡片
  var LS_DELETED = 'bdh_deleted_v1';       // 本地隐藏的云端卡片 id
  var LS_DATA_CACHE = 'bdh_data_cache_v1'; // data.json 离线缓存
  var LS_IV_CACHE = 'bdh_iv_cache_v1';     // interview.json 离线缓存

  /* ---------- 工具 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(dateStr, n) {
    var p = dateStr.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function daysUntil(dateStr) {
    if (!dateStr) return 9999;
    var p = dateStr.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  }
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  function fmtDate(s) { if (!s) return '未安排'; var p = s.slice(0, 10).split('-'); return (+p[1]) + '月' + (+p[2]) + '日'; }
  function hasType(row, text) { var arr = row['知识类型'] || []; for (var i = 0; i < arr.length; i++) { if (arr[i] === text) return true; } return false; }
  function levelClass(level) {
    if (level === '已掌握') return 'l2';
    if (level === '学习中') return 'l1';
    return 'l0';
  }

  /* ---------- 本地存储 ---------- */
  function lsGet(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }
  function getProgress() { return lsGet(LS_PROGRESS, {}); }
  function getCustom() { return lsGet(LS_CUSTOM, []); }
  function getDeleted() { return lsGet(LS_DELETED, []); }

  /* ---------- 数据 ---------- */
  /* 云端基础卡片 + 本地覆盖/新增 → 有效行 */
  function buildRows(baseList) {
    var prog = getProgress();
    var deleted = getDeleted();
    var rows = [];
    (baseList || []).forEach(function (c) {
      if (deleted.indexOf(c.id) >= 0) return;
      var row = {
        _id: c.id, _base: true,
        '名称': c.name || '未命名',
        '技术栈': c.stack || '其他',
        '知识类型': c.types || [],
        '掌握度': c.level || '待学习',
        '详细内容': c.content || '',
        '结构图': c.diagram || '',
        '复习次数': c.reviewCount || 0,
        '上次复习': c.lastReview || '',
        '下次复习': c.nextReview || ''
      };
      var ov = prog[c.id];
      if (ov) { for (var k in ov) { if (ov[k] !== undefined && ov[k] !== null && ov[k] !== '') row[k] = ov[k]; } }
      rows.push(row);
    });
    getCustom().forEach(function (c) {
      rows.push({
        _id: c.id, _base: false,
        '名称': c.name, '技术栈': c.stack, '知识类型': c.types || [],
        '掌握度': c.level || '待学习', '详细内容': c.content || '',
        '结构图': c.diagram || '',
        '复习次数': c.reviewCount || 0, '上次复习': c.lastReview || '', '下次复习': c.nextReview || ''
      });
    });
    return rows;
  }

  /* 拉取 data.json（带当日 cache-bust），失败回退本地缓存；cb(rows, ok, count) */
  function loadRows(cb) {
    setSync(null);
    var cacheBust = todayStr().replace(/-/g, '');
    fetch('data.json?t=' + cacheBust, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    }).then(function (list) {
      lsSet(LS_DATA_CACHE, list);
      var rows = buildRows(list);
      cb(rows, true, rows.length);
    }).catch(function () {
      var cached = lsGet(LS_DATA_CACHE, null);
      if (cached && cached.length) {
        var rows2 = buildRows(cached);
        toast('云端数据加载失败，已使用本机缓存');
        cb(rows2, false, rows2.length);
      } else {
        toast('数据加载失败，请刷新重试');
        cb([], false, 0);
      }
    });
  }

  /* 拉取 interview.json；cb(bank|null) */
  function loadInterview(cb) {
    var cacheBust = todayStr().replace(/-/g, '');
    fetch('interview.json?t=' + cacheBust, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    }).then(function (bank) {
      lsSet(LS_IV_CACHE, bank);
      cb(bank);
    }).catch(function () {
      var cached = lsGet(LS_IV_CACHE, null);
      if (cached && cached.categories) cb(cached);
      else cb(null);
    });
  }

  /* ---------- 复习动作（写本地覆盖） ---------- */
  function completeReview(r) {
    var n = r['复习次数'] || 0;
    var newN = n + 1;
    var interval = INTERVALS[Math.min(n, INTERVALS.length - 1)];
    var nextDate = addDays(todayStr(), interval);
    var lv = r['掌握度'] || '待学习';
    var newLevel = lv;
    if (newN >= 3) { newLevel = '已掌握'; }
    else if (newN >= 1 && lv === '待学习') { newLevel = '学习中'; }
    r['复习次数'] = newN; r['上次复习'] = todayStr(); r['下次复习'] = nextDate; r['掌握度'] = newLevel;
    persistRow(r);
    toast('复习完成！下次复习：' + fmtDate(nextDate) + '（间隔 ' + interval + ' 天）');
    return { count: newN, nextDate: nextDate, interval: interval, level: newLevel };
  }

  /* 把当前行状态写入本地 */
  function persistRow(r) {
    if (r._base) {
      var prog = getProgress();
      prog[r._id] = {
        '复习次数': r['复习次数'] || 0,
        '上次复习': r['上次复习'] || '',
        '下次复习': r['下次复习'] || '',
        '掌握度': r['掌握度'] || '待学习'
      };
      lsSet(LS_PROGRESS, prog);
    } else {
      var custom = getCustom();
      for (var i = 0; i < custom.length; i++) {
        if (custom[i].id === r._id) {
          custom[i] = rowToCard(r);
          lsSet(LS_CUSTOM, custom);
          return;
        }
      }
    }
  }

  function rowToCard(r) {
    return {
      id: r._id, name: r['名称'], stack: r['技术栈'], types: r['知识类型'] || [],
      level: r['掌握度'] || '待学习', content: r['详细内容'] || '',
      diagram: r['结构图'] || '',
      reviewCount: r['复习次数'] || 0, lastReview: r['上次复习'] || '', nextReview: r['下次复习'] || ''
    };
  }

  /* ---------- 同步状态 / 导出 ---------- */
  function setSync(ok, count) {
    var dot = $('syncDot'), txt = $('syncText');
    if (!dot || !txt) return;
    dot.className = 'sync-dot' + (ok === true ? ' ok' : (ok === false ? ' off' : ''));
    txt.textContent = ok === true ? ('云端 ' + count + ' 条') : (ok === false ? '缓存模式' : '加载中');
  }

  function exportJSON(rows) {
    var payload = { app: 'zhongwang 的大数据宝典', exportedAt: new Date().toISOString(), count: rows.length, rows: rows.map(function (r) { return rowToCard(r); }) };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'zhongwang大数据宝典备份_' + todayStr() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('已导出 ' + rows.length + ' 条备份');
  }

  /* ---------- 卡片详情子页 URL ---------- */
  function cardUrl(id) { return 'card.html?id=' + encodeURIComponent(id); }

  /* ---------- Markdown-lite（标题带锚点，供子页目录跳转） ---------- */
  function renderMarkdown(text) {
    if (!text) return '';
    var out = '';
    var secIdx = 0;
    var blocks = String(text).split(/```/);
    for (var b = 0; b < blocks.length; b++) {
      if (b % 2 === 1) {
        out += '<pre><code>' + esc(blocks[b].replace(/^\n/, '').replace(/\n$/, '')) + '</code></pre>';
      } else {
        out += renderInlineBlocks(blocks[b], function () { return 'bd-sec-' + (secIdx++); });
      }
    }
    return out;
  }
  function renderInlineBlocks(block, nextId) {
    var lines = block.split(/\n/);
    var out = '';
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var t = ln.trim();
      if (!t) { if (inList) { out += '</ul>'; inList = false; } continue; }
      var h3 = t.match(/^#{3}\s+(.*)/);
      var h2 = t.match(/^#{2}\s+(.*)/);
      var li = t.match(/^[-*]\s+(.*)/);
      if (h2) { if (inList) { out += '</ul>'; inList = false; } out += '<h3 id="' + nextId() + '">' + inline(esc(h2[1])) + '</h3>'; }
      else if (h3) { if (inList) { out += '</ul>'; inList = false; } out += '<h4 id="' + nextId() + '">' + inline(esc(h3[1])) + '</h4>'; }
      else if (li) {
        if (!inList) { out += '<ul>'; inList = true; }
        out += '<li>' + inline(esc(li[1])) + '</li>';
      } else {
        if (inList) { out += '</ul>'; inList = false; }
        out += '<p>' + inline(esc(t)) + '</p>';
      }
    }
    if (inList) out += '</ul>';
    return out;
  }
  function inline(s) {
    return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  /* 提取 ##/### 标题作为子知识点目录（与 renderMarkdown 锚点顺序一致） */
  function extractSections(text) {
    if (!text) return [];
    var secs = [];
    var blocks = String(text).split(/```/);
    for (var b = 0; b < blocks.length; b++) {
      if (b % 2 === 1) continue; // 代码块内不算标题
      var lines = blocks[b].split(/\n/);
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim();
        var h2 = t.match(/^#{2}\s+(.*)/);
        var h3 = t.match(/^#{3}\s+(.*)/);
        if (h2) secs.push({ level: 2, title: h2[1].replace(/\*\*/g, '') });
        else if (h3) secs.push({ level: 3, title: h3[1].replace(/\*\*/g, '') });
      }
    }
    return secs;
  }

  window.BD = {
    STACKS: STACKS, TYPES: TYPES, INTERVALS: INTERVALS,
    LS_PROGRESS: LS_PROGRESS, LS_CUSTOM: LS_CUSTOM, LS_DELETED: LS_DELETED,
    LS_DATA_CACHE: LS_DATA_CACHE, LS_IV_CACHE: LS_IV_CACHE,
    pad: pad, todayStr: todayStr, addDays: addDays, daysUntil: daysUntil,
    esc: esc, $: $, toast: toast, fmtDate: fmtDate, hasType: hasType, levelClass: levelClass,
    lsGet: lsGet, lsSet: lsSet, lsDel: lsDel, getProgress: getProgress, getCustom: getCustom, getDeleted: getDeleted,
    buildRows: buildRows, loadRows: loadRows, loadInterview: loadInterview,
    completeReview: completeReview, persistRow: persistRow, rowToCard: rowToCard,
    setSync: setSync, exportJSON: exportJSON, cardUrl: cardUrl,
    renderMarkdown: renderMarkdown, extractSections: extractSections
  };
})();
