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

  /* ---------- 中间件题库：模块清单 + 二级页 URL ---------- */
  var BANK_MODULES = [
    { slug: 'hadoop',  name: 'Hadoop',        icon: 'H',  color: '#e97',     desc: '分布式存储与计算基石（HDFS/YARN/MapReduce/ZK）', topics: [
      { t: 'HDFS 架构与读写流程',                d: 'NameNode/DataNode 角色分工、读写链路、机架感知', card: '0PpoJou9NYBnUCAICET1pA' },
      { t: 'HDFS 写入流程与副本放置策略',          d: 'Pipeline 写入、副本 2 副本本机架 1 跨机架',     card: 'z56UxRmtMyhixEf4bE7ojg' },
      { t: 'HDFS 小文件问题与治理',                d: 'NameNode 内存压力、合并方案 SequenceFile/HAR',  card: 'pMBgBkhavewNpF0kuJdUpW' },
      { t: 'YARN 资源调度器详解',                  d: 'Capacity/Fair/FIFO 调度器对比、资源抢占',        card: 'mVBwsMkTiX8GRzirKU728v' },
      { t: 'MapReduce 原理与 WordCount 实战',      d: 'Map/Reduce/Combiner/Partitioner 全流程',         card: 'nls5CQodTObckjnn4qKxud' },
      { t: 'Hadoop 3.x 新特性',                    d: '纠删码、NameNode 联邦、多级缓存',               card: 'HdUDlRtBKt0UAfwH1Au5X2' },
      { t: 'ZooKeeper 分布式协调原理',              d: 'ZAB 协议、Watcher 机制、分布式锁实现',           card: 'ZRC3az5RGDVjPVhb9xBUAa' }
    ] },
    { slug: 'spark',    name: 'Spark',          icon: 'S',  color: '#e2572b',  desc: '内存计算引擎（Core/SQL/Streaming）', topics: [
      { t: 'Spark Core RDD 原理',                  d: 'RDD 血缘、宽窄依赖、算子分类',                  card: '5SrKCOwumUOxXMRzRRZSX3' },
      { t: 'Spark 运行架构与任务调度',              d: 'Driver/Executor/Master-Worker、DAG 切分 Stage', card: 'GSu1zZ93ksMbRr26NYi7I0' },
      { t: 'Spark Shuffle 原理与优化',             d: 'Hash/Sort/Bypass 三种机制、参数调优',           card: 'qTUMlaeNVnghaExATh5Ax2' },
      { t: 'Spark SQL 与 Catalyst 优化器',         d: '解析/优化/物理计划、RBO/CBO 规则',               card: 'iWlapMBbrj9FMnZkJrMzcb' },
      { t: 'Spark 内存模型与统一内存管理',          d: 'Execution/Storage/统一内存动态调整',            card: 'spark-memory-model' },
      { t: 'Spark 数据倾斜治理',                    d: '加盐/两阶段聚合/广播 Join 方案',                card: 'q1zNGaQNWy4dwe9f4NHhf2' },
      { t: 'Spark 调优实战',                        d: '并行度、序列化、cache 策略、GC 调优',           card: 'e0PrpOINAcQU23iBrXcFPp' },
      { t: 'Spark Structured Streaming 流处理',     d: '微批模型、EventTime、Watermark、状态存储',     card: 'spark-structured-streaming' }
    ] },
    { slug: 'flink',    name: 'Flink',          icon: 'F',  color: '#e65100',  desc: '流批一体实时计算引擎', topics: [
      { t: 'Flink 核心概念与架构',                  d: 'JobManager/TaskManager/Slot、DataStream API',   card: 'K5tikDpiEji4U6uxLizX5X' },
      { t: 'Flink 状态管理与 Checkpoint',          d: 'Keyed/Operator State、RocksDB 后端',           card: 'CYp6jLShogRp4Hamfzlhcc' },
      { t: 'Flink Window 机制详解',                 d: '滚动/滑动/会话窗口、EventTime/ProcessTime',     card: 'EwysXZ3hTHBsChtqAVjFck' },
      { t: 'Flink Checkpoint 与 Exactly-Once',      d: 'Barrier 对齐、两阶段提交 Sink',                 card: 'NVYIgq9NAO8i8shLbKjdv8' },
      { t: 'Flink 反压机制与性能诊断',              d: 'Credit-Based 流控、Web UI 反压指标、治理方案', card: 'flink-backpressure-diagnosis' },
      { t: 'Flink SQL 实战',                        d: '动态表、时间属性、Window TVF、Retract 流',      card: 'RgkgLxbdp266FQiRyEUbH7' },
      { t: 'Flink CEP 复杂事件处理实战',            d: 'Pattern 定义、超时处理、检测状态机',           card: 'flink-cep-complex-event-processing' }
    ] },
    { slug: 'kafka',    name: 'Kafka',          icon: 'K',  color: '#23880',   desc: '高吞吐分布式消息队列（含 Pulsar/RocketMQ）', topics: [
      { t: 'Kafka 架构与高吞吐原理',                d: 'Topic/Partition、顺序写、零拷贝、批量',         card: 'Yspa5py14czJtYM4Ly7nH5' },
      { t: 'Kafka 消息可靠性三要素',                d: 'Producer ACK、Broker 副本、Consumer 提交',      card: 'BOCoi4L5ECzyXkUiBN4gX3' },
      { t: 'Kafka 消费者组与 Rebalance',            d: '分区分配策略、Rebalance 触发与避免',           card: 'ayscxh4qfZbVqk55Sd5pAG' },
      { t: 'Kafka ISR 机制与副本同步',              d: 'LEO/High Watermark、ISR 收缩与 Leader 选举',    card: 'kafka-isr-replica-sync' },
      { t: 'Kafka Exactly-Once 与幂等',             d: '幂等生产者、事务、Read Committed',              card: 'lW0AZkmXX5kSlpH69kjXTq' },
      { t: 'Apache Pulsar 架构与优势',              d: '存算分离、BookKeeper、分层存储',               card: 'aJYNybLkVHl3CBDpdPIRLb' },
      { t: 'RocketMQ 核心概念',                     d: 'NameServer/CommitLog/消息重试与事务',          card: 'pP8qQXOqLy4AZGqr6TbGLl' }
    ] },
    { slug: 'hive',     name: 'Hive',           icon: 'H',  color: '#f9a825',  desc: '数据仓库 SQL 引擎', topics: [
      { t: 'Hive 架构与执行流程',                    d: 'HiveServer2/Metastore/Driver 编译流程',         card: 'piINQ89RgP0FmbhWaIUreN' },
      { t: 'Hive 数据倾斜排查与优化',                d: '倾斜定位、GroupBy/SkewJoin 参数、Map Join',    card: 'ATbKLZUaMuFnkw6s71b1Wi' },
      { t: 'Hive 分区与分桶设计实战',                d: '静态/动态分区、分桶原理与 Map-Side Join',      card: 'hive-partition-bucket-design' },
      { t: 'Hive SQL 优化实战',                      d: 'CBO、向量化、并行执行、分区裁剪',              card: '6hBG22IXPCib8ZFNZu9QXs' },
      { t: 'Hive 常用函数速查手册',                  d: '窗口函数/UDTF/日期与字符串函数',               card: 'jTpsaLRkFBmLrBA65HgwTa' }
    ] },
    { slug: 'hbase',    name: 'HBase',          icon: 'H',  color: '#556b2f',  desc: '分布式列式 NoSQL 数据库', topics: [
      { t: 'HBase 架构与数据模型',                  d: 'Region/Store/MemStore、LSM-Tree、读写流程',    card: 'EWZvXrH6Pe4O3Eh05vIMaL' },
      { t: 'HBase RowKey 设计最佳实践',            d: '避免热点、散列/反转/加盐策略',                  card: '3Aq1vJj4D3fps9AhnQe9Id' },
      { t: 'HBase Compaction 与读写放大',          d: 'Minor/Major Compaction、LSM 合并策略',         card: 'hbase-compaction-read-write-amplification' }
    ] },
    { slug: 'clickhouse', name: 'ClickHouse',    icon: 'C',  color: '#ffcc00',  desc: 'OLAP 列式分析数据库', topics: [
      { t: 'ClickHouse 架构与 MergeTree 原理',     d: '列存压缩、分区/主键/稀疏索引',                  card: 'C6B1kfvczWeQOvQDriSGfI' },
      { t: 'ClickHouse 查询优化实战',               d: 'PREWHERE、采样、物化视图、跳数索引',           card: 'rqpFoJbVswTeOaS4Kr0JnA' }
    ] },
    { slug: 'doris',    name: 'Doris',          icon: 'D',  color: '#00bcd4',  desc: 'MPP 实时分析型数据库', topics: [
      { t: 'Doris 架构与数据模型',                  d: 'FE/BE、Duplicate/Agg/Unique 模型',              card: 'u1k0Ta3ALHsbcNGK1Ju7i5' },
      { t: 'Doris 导入导出与查询实战',              d: 'Stream Load/Broker Load、分桶与 Colocate',     card: 'arRCYopaXKqS1ANilcEFMH' }
    ] },
    { slug: 'datalake', name: '数据湖',          icon: '湖', color: '#0288d1',  desc: 'Iceberg / Hudi / Delta 表格式', topics: [
      { t: '数据湖 vs 数据仓库',                    d: 'Schema on Read、ACID 湖仓一体演进',             card: 'pUyw6wxE4EyC0gMzFCOD79' },
      { t: 'Apache Iceberg 架构与核心特性',        d: '快照/元数据分层、Hidden Partitioning',         card: 'XhjCsCiAIxIcyvEPF0KaKe' },
      { t: 'Apache Hudi 核心特性',                  d: 'COW/MOR、增量查询、Timeline',                  card: 'GiFN4FnElmWN6FoDFLZlSK' },
      { t: 'Delta Lake 核心概念',                   d: '事务日志、Optimize/Z-Order',                   card: 'KYjZ2dBfiEo1BchI6L8v5y' }
    ] },
    { slug: 'dw',       name: '数仓与调度',      icon: '仓', color: '#7b1fa2',  desc: '分层建模 / DolphinScheduler / DataX', topics: [
      { t: '数仓分层设计规范',                      d: 'ODS/DWD/DWS/ADS 分层职责与命名',               card: '76V5C48unio29E6uH0JGTb' },
      { t: '维度建模：星型模型与雪花模型',          d: '事实表/维度表、缓慢变化维 SCD',                card: 'pNMDnDrCgWPf9P1KSHoUlL' },
      { t: '离线数仓架构方案',                      d: '数据源→ODS→ADS 全链路设计',                    card: 'Oou9kRrMPSL0SnCgE9lsnd' },
      { t: '实时数仓架构方案',                      d: 'Kafka→Flink→OLAP Lambda/Kappa 架构',           card: 'e5kogFouivgZTkxXNNwHe4' },
      { t: '数据同步工具：DataX / SeaTunnel / Sqoop', d: '分片并行、限速、增量同步策略',              card: '5mdLv1zDE1TOvwbeJDXBSA' },
      { t: '调度系统选型：DolphinScheduler / Airflow / Azkaban', d: 'DAG 依赖、补数、告警与容错',           card: 'kE6YGg5T1kbag3yN6RslbX' }
    ] },
    { slug: 'search',   name: '检索与查询',      icon: 'ES', color: '#e91e63',  desc: 'Elasticsearch / Presto / Trino', topics: [
      { t: 'Elasticsearch 核心原理',                d: '倒排索引、分片/副本、Refresh/Translog',         card: 'fpM4UPwh17LpvdQJwH3ClZ' },
      { t: 'Presto/Trino 原理与使用',               d: 'Coordinator/Worker、内存计算、Connector',       card: 'presto-trino-overview' }
    ] },
    { slug: 'graph',    name: '图数据库',        icon: '图', color: '#00897b',  desc: 'Neo4j / NebulaGraph / JanusGraph / ArangoDB', topics: [
      { t: 'Neo4j 架构与 Cypher 查询实战',          d: '原生图存储、Cypher 模式匹配、Causal 集群',     card: 'neo4j-architecture-cypher' },
      { t: 'NebulaGraph 分布式图数据库原理',        d: '存算分离三层架构、nGQL、VID 设计',              card: 'nebulagraph-distributed-architecture' },
      { t: 'JanusGraph 架构与 Gremlin 查询实战',    d: '存储/索引分离、复合/混合索引',                 card: 'janusgraph-architecture-gremlin' },
      { t: 'ArangoDB 架构与多模型原理',             d: '文档/图/KV 三模型一体、Coordinator 集群',     card: 'arangodb-multi-model-architecture' },
      { t: 'ArangoDB AQL 查询与图遍历实战',         d: 'FOR/FILTER/RETURN、图遍历与 PRUNE',             card: 'arangodb-aql-graph-traversal' }
    ] },
    { slug: 'algo',     name: '算法',            icon: 'LC', color: '#f57c00',  desc: 'LeetCode Hot 100 高频算法题', topics: [
      { t: '两数之和与哈希表应用',                  d: '空间换时间、三数之和排序+双指针',              card: 'leetcode-two-sum-hash' },
      { t: '反转链表与链表核心技巧',                d: '三指针迭代、快慢指针判环',                     card: 'leetcode-reverse-linked-list' },
      { t: '二叉树遍历与递归框架',                  d: '前中后序、层序 BFS、Morris O(1) 空间',         card: 'leetcode-binary-tree-traversal' },
      { t: '动态规划入门：爬楼梯与 LIS',            d: '状态定义与转移方程、滚动数组优化',             card: 'leetcode-dp-intro' },
      { t: '双指针技巧：盛水容器与三数之和',        d: '对撞指针、去重技巧',                           card: 'leetcode-two-pointers' },
      { t: '链表进阶专题（12题）',                   d: '合并K个链表、K个一组翻转、回文链表',           card: 'leetcode-linked-list-advanced' },
      { t: '二叉树进阶专题（12题）',                 d: 'LCA、最大路径和、重建二叉树、前缀和',          card: 'leetcode-binary-tree-advanced' },
      { t: '动态规划进阶专题（15题）',               d: '01/完全背包、LCS、编辑距离、树形DP',          card: 'leetcode-dp-advanced' },
      { t: '回溯与DFS专题（14题）',                  d: '全排列、N皇后、子集去重、单词搜索',           card: 'leetcode-backtracking-dfs' },
      { t: '滑动窗口与字符串专题（14题）',            d: '最小覆盖子串、单调栈、KMP、中心扩展',         card: 'leetcode-sliding-window-string' },
      { t: '栈与单调栈专题（10题）',                  d: '接雨水、柱状图最大矩形、计算器',                card: 'leetcode-stack-monotonic' },
      { t: '贪心算法专题（10题）',                    d: '跳跃游戏、股票买卖系列、区间贪心',              card: 'leetcode-greedy' },
      { t: '图论BFS与DFS专题（12题）',                d: '岛屿数量、拓扑排序、并查集、多源BFS',          card: 'leetcode-graph-bfs-dfs' },
      { t: '排序与二分查找专题（10题）',              d: '旋转数组、快速选择、摩尔投票',                  card: 'leetcode-sort-binary-search' },
      { t: '高级数据结构专题（10题）',                d: 'Trie、LRU/LFU、双堆中位数',                    card: 'leetcode-advanced-ds' }
    ] },
    { slug: 'basic',    name: '基础与综合',      icon: '基', color: '#546e7a',  desc: 'Linux / Java / 技术选型 / 全景图', topics: [
      { t: 'Linux 与 Shell 大数据必备技能',         d: '常用命令、三剑客 awk/sed/grep、性能排查',       card: '1iFECrgZCLOIBBTXTsYfv5' },
      { t: 'Java 大数据开发必备基础',               d: 'JVM 内存模型、GC、集合与并发',                  card: 'cKujhOXUEN2BzwTdWXQdqN' },
      { t: '大数据技术全景图',                        d: '采集→存储→计算→分析→调度全景',                  card: '1cWXtCG1Pjv238XsHSqCAu' },
      { t: '大数据学习路线图（由浅入深）',            d: '从 Hadoop 入门到实时数仓进阶',                  card: 'GG5pjLPT82vURw9t1czy1E' },
      { t: 'Spark vs Flink 对比',                    d: '流批模型、状态、生态对比选型',                  card: 'cNJwGk7QLTgVfqzBjCKCDi' },
      { t: '消息队列选型对比',                        d: 'Kafka/Pulsar/RocketMQ 横向对比',                card: 'GnvAfPqlHVtDPtSn4b4Gu8' },
      { t: '大数据开源项目全景图谱',                  d: 'Apache 生态一览与学习优先级',                   card: 'Mj31pK7BD27NiWeag75YDu' },
      { t: '开源项目选型指南',                        d: '社区活跃度、生产验证、人才储备',                card: '9HbpZevt96VHhmsW7Kt0eh' }
    ] }
  ];

  function findModule(slug) {
    for (var i = 0; i < BANK_MODULES.length; i++) {
      if (BANK_MODULES[i].slug === slug) return BANK_MODULES[i];
    }
    return null;
  }

  function moduleUrl(slug) { return 'module.html?id=' + encodeURIComponent(slug); }

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
    setSync: setSync, exportJSON: exportJSON, cardUrl: cardUrl, moduleUrl: moduleUrl, findModule: findModule,
    BANK_MODULES: BANK_MODULES,
    renderMarkdown: renderMarkdown, extractSections: extractSections
  };
})();
