// ===== 外部协作反馈门户 =====
// 品牌方 / 监管方 / 媒体经门户提交证据、整改进度、媒体问询与监管整改通知；
// 内部受理 → 审核采纳（回写协同工单、预警状态、危机统一时间线）/ 退回 / 官方回复 / 关闭；
// 新提交与监管紧急件复用通知编排生成通知任务（待办提醒 + 回执超时升级）。
import { db } from './db.js'
import { now, addTimeline, LV_TEXT } from './pipeline.js'
import { logWorkOrder, addDispatchTimeline } from './dispatch.js'
import { createWorkOrder } from './workorders.js'

const q = (sql, ...p) => db.prepare(sql).all(...p)
const q1 = (sql, ...p) => db.prepare(sql).get(...p)
const run = (sql, ...p) => db.prepare(sql).run(...p)

// ===== 常量与口径 =====
export const EXT_PARTY = { brand: '品牌方', regulator: '监管方', media: '媒体' }
export const EXT_PARTY_ICON = { brand: '🏪', regulator: '⚖️', media: '📰' }
export const EXT_KIND = { evidence: '证据材料', rectification: '整改进度', inquiry: '媒体问询', directive: '监管整改通知' }
export const EXT_PRIORITY = { urgent: '紧急', high: '高', normal: '普通' }
export const EXT_STATUS = { pending: '待审核', reviewing: '审核中', approved: '已采纳', rejected: '已退回', closed: '已关闭' }
const ACTIVE_STATUS = ['pending', 'reviewing']
const FINAL_STATUS = ['approved', 'rejected', 'closed']

// 通知联动钩子（index.js 注入，避免模块循环依赖）
let notifyHooks = { generate: null }
export function bindExternalNotify(h) { notifyHooks = { ...notifyHooks, ...h } }
function fireGenerate(id, event) {
  if (!notifyHooks.generate) return
  try { notifyHooks.generate(id, event) } catch (e) { console.error('[EXTERNAL] 通知生成失败：', e.message) }
}

// ===== 访问码与受理编号 =====
function codeSeq() {
  const d = new Date()
  const p = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  // 顺序生成并跳过已占用编号（种子/历史编号可能不从 0001 开始）
  let seq = q1("SELECT COUNT(*) c FROM ext_submissions WHERE code LIKE ?", `EXT-${p}-%`).c + 1
  let code = `EXT-${p}-${String(seq).padStart(4, '0')}`
  while (q1('SELECT 1 FROM ext_submissions WHERE code=?', code)) {
    seq += 1
    code = `EXT-${p}-${String(seq).padStart(4, '0')}`
  }
  return { p, seq: String(seq).padStart(4, '0') }
}
function genAccessCode(prefix) {
  let code = ''
  for (let i = 0; i < 3; i++) code += String(100 + Math.floor(Math.random() * 900))
  code = code.slice(0, 6)
  return `${prefix}-${code}`
}
function uniqueAccessCode(prefix) {
  for (let i = 0; i < 10; i++) {
    const c = genAccessCode(prefix)
    if (!q1('SELECT 1 FROM ext_contacts WHERE access_code=?', c)) return c
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`
}

function addLog(subId, action, detail, operator = '系统', side = 'internal') {
  run('INSERT INTO ext_submission_logs (submission_id,action,detail,operator,operator_side,time) VALUES (?,?,?,?,?,?)',
    subId, action, detail || '', operator, side, now())
}

// ===== 外部联络方名录（admin 维护） =====
export function listContacts({ keyword = '', partyType = '' } = {}) {
  let sql = 'SELECT * FROM ext_contacts WHERE 1=1'
  const args = []
  if (partyType && EXT_PARTY[partyType]) { sql += ' AND party_type=?'; args.push(partyType) }
  if (keyword) {
    sql += ' AND (name LIKE ? OR contact_person LIKE ? OR access_code LIKE ?)'
    args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  sql += ' ORDER BY id DESC'
  return q(sql, ...args).map((c) => ({ ...c, partyText: EXT_PARTY[c.party_type] || c.party_type }))
}

export function createContact(body, actor) {
  const b = body || {}
  const name = String(b.name || '').trim()
  if (!name) return { error: '机构名称必填' }
  const partyType = EXT_PARTY[b.party_type] ? b.party_type : 'brand'
  const ts = now()
  const code = uniqueAccessCode({ brand: 'BR', regulator: 'REG', media: 'MED' }[partyType])
  const r = run(`INSERT INTO ext_contacts (name,party_type,contact_person,contact,access_code,enabled,note,created,created_by)
    VALUES (?,?,?,?,?,1,?,?,?)`,
    name, partyType, String(b.contact_person || '').trim(), String(b.contact || '').trim(), code,
    String(b.note || '').trim(), ts, actor.user)
  return { ok: true, id: Number(r.lastInsertRowid), accessCode: code }
}

export function updateContact(id, body, actor) {
  const c = q1('SELECT * FROM ext_contacts WHERE id=?', id)
  if (!c) return null
  const b = body || {}
  const name = String(b.name || '').trim() || c.name
  const partyType = EXT_PARTY[b.party_type] ? b.party_type : c.party_type
  run(`UPDATE ext_contacts SET name=?,party_type=?,contact_person=?,contact=?,note=? WHERE id=?`,
    name, partyType, String(b.contact_person ?? c.contact_person).trim(),
    String(b.contact ?? c.contact).trim(), String(b.note ?? c.note).trim(), id)
  return { ok: true }
}

export function toggleContact(id) {
  const c = q1('SELECT * FROM ext_contacts WHERE id=?', id)
  if (!c) return null
  run('UPDATE ext_contacts SET enabled=? WHERE id=?', c.enabled ? 0 : 1, id)
  return { ok: true, enabled: c.enabled ? 0 : 1 }
}

export function resetContactCode(id) {
  const c = q1('SELECT * FROM ext_contacts WHERE id=?', id)
  if (!c) return null
  const code = uniqueAccessCode({ brand: 'BR', regulator: 'REG', media: 'MED' }[c.party_type])
  run('UPDATE ext_contacts SET access_code=? WHERE id=?', code, id)
  return { ok: true, accessCode: code }
}

export function deleteContact(id) {
  run('DELETE FROM ext_contacts WHERE id=?', id) // 既有提交保留机构快照（contact_id 悬空不影响展示）
  return { ok: true }
}

// ===== 提交校验（门户与内部共用） =====
function validateSubmission(b) {
  if (!b || typeof b !== 'object') return '提交内容格式错误'
  const title = String(b.title || '').trim()
  if (!title) return '标题必填'
  const content = String(b.content || '').trim()
  if (!content) return '正文必填（请描述证据/整改进度/问询事项）'
  const kind = EXT_KIND[b.kind] ? b.kind : 'evidence'
  const priority = EXT_PRIORITY[b.priority] ? b.priority : 'normal'
  const partyType = EXT_PARTY[b.party_type] ? b.party_type : 'brand'
  if (b.crisis_id && !q1('SELECT 1 FROM crisis WHERE id=?', +b.crisis_id)) return '关联危机事件不存在'
  return null
}

function decorate(s) {
  return {
    ...s,
    partyText: EXT_PARTY[s.party_type] || s.party_type,
    kindText: EXT_KIND[s.kind] || s.kind,
    priorityText: EXT_PRIORITY[s.priority] || s.priority,
    statusText: EXT_STATUS[s.status] || s.status
  }
}

// ===== 门户提交（外部，凭访问码；访客可直发） =====
// 访问码命中启用名录则继承联络方身份；未带/不匹配视为访客提交（仍可受理）。
export function submitExternal(body) {
  const b = body || {}
  const err = validateSubmission(b)
  if (err) return { error: err }
  const ts = now()
  const { p, seq } = codeSeq()
  const code = `EXT-${p}-${seq}`
  let contact = null
  const accessCode = String(b.access_code || '').trim()
  if (accessCode) contact = q1('SELECT * FROM ext_contacts WHERE access_code=? AND enabled=1', accessCode)
  const partyType = contact ? contact.party_type : (EXT_PARTY[b.party_type] ? b.party_type : 'brand')
  const orgName = contact ? contact.name : String(b.org_name || '访客').trim()
  const person = contact ? contact.contact_person : String(b.contact_person || '').trim()
  const contactInfo = contact ? contact.contact : String(b.contact || '').trim()
  const kind = EXT_KIND[b.kind] ? b.kind : 'evidence'
  // 监管紧急整改通知默认紧急；其余以提交方选择为准
  const priority = kind === 'directive' && partyType === 'regulator' && !b.priority ? 'urgent'
    : EXT_PRIORITY[b.priority] ? b.priority : 'normal'
  const crisisId = b.crisis_id ? +b.crisis_id : null

  const r = run(`INSERT INTO ext_submissions
    (code,contact_id,party_type,org_name,contact_person,contact,crisis_id,kind,priority,title,content,evidence_desc,evidence_url,
     status,escalated,created,updated)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending',0,?,?)`,
    code, contact ? contact.id : null, partyType, orgName, person, contactInfo, crisisId, kind, priority,
    String(b.title || '').trim(), String(b.content || '').trim(),
    String(b.evidence_desc || '').trim(), String(b.evidence_url || '').trim(), ts, ts)
  const id = Number(r.lastInsertRowid)
  addLog(id, 'submit', `${EXT_PARTY[partyType]}通过外部协作门户提交${EXT_KIND[kind]}` + (accessCode ? `（访问码 ${accessCode}）` : '（访客直发）'),
    person || orgName, 'external')

  // 通知编排：新提交待办提醒；监管紧急整改通知同时触发升级通知（需回执，超时再升级）
  fireGenerate(id, 'new')
  const urgent = partyType === 'regulator' && priority === 'urgent'
  if (urgent) {
    run('UPDATE ext_submissions SET escalated=1 WHERE id=?', id)
    addLog(id, 'escalate', '监管方紧急整改通知：自动联动通知升级（升级专线 + 回执超时升级）', '系统', 'internal')
    fireGenerate(id, 'escalate')
  }
  return { ok: true, id, code, urgent, matched: !!contact }
}

// 门户补充材料（外部，凭受理编号 + 访问码；访问码可空仅当与提交留档机构一致）
export function supplementExternal(body) {
  const b = body || {}
  const code = String(b.code || '').trim()
  const content = String(b.content || '').trim()
  if (!code) return { error: '请填写受理编号' }
  const s = q1('SELECT * FROM ext_submissions WHERE code=?', code)
  if (!s) return { error: '受理编号不存在，请核对后重试' }
  if (s.status === 'closed') return { error: '该受理单已关闭，不能补充材料（可重新提交）' }
  if (!content) return { error: '补充内容必填' }
  if (s.contact_id) {
    const accessCode = String(b.access_code || '').trim()
    const ct = q1('SELECT 1 FROM ext_contacts WHERE id=? AND access_code=? AND enabled=1', s.contact_id, accessCode)
    if (!ct) return { error: '访问码与受理单归属机构不一致，不能补充材料' }
  }
  const ts = now()
  const extra = String(b.evidence_desc || '').trim()
  run(`UPDATE ext_submissions SET content=content||?||?, evidence_desc=CASE WHEN ?='' THEN evidence_desc ELSE evidence_desc||?||? END,
    evidence_url=COALESCE(NULLIF(?,''),evidence_url), updated=? WHERE id=?`,
    `\n\n【补充材料 ${ts}】\n`, content,
    extra, extra ? `\n附件补充：${extra}` : '', '', String(b.evidence_url || '').trim(), ts, s.id)
  addLog(s.id, 'supplement', `外部补充材料：${content.slice(0, 80)}${content.length > 80 ? '…' : ''}`,
    s.contact_person || s.org_name, 'external')
  // 退回后补充：自动回到待审核并再次提醒
  if (s.status === 'rejected') {
    run("UPDATE ext_submissions SET status='pending', reviewed_by='', reviewed_at=NULL, review_note='' WHERE id=?", s.id)
    addLog(s.id, 'resubmit', '按退回意见补充材料后重新提交，回到待审核', s.contact_person || s.org_name, 'external')
    fireGenerate(s.id, 'new')
  }
  return { ok: true }
}

// 门户状态查询（外部，凭受理编号 + 访问码；仅返回对外可见字段）
export function publicStatus(code, accessCode) {
  const s = q1('SELECT * FROM ext_submissions WHERE code=?', String(code || '').trim())
  if (!s) return { error: '受理编号不存在，请核对后重试' }
  if (s.contact_id) {
    const ct = q1('SELECT 1 FROM ext_contacts WHERE id=? AND access_code=?', s.contact_id, String(accessCode || '').trim())
    if (!ct) return { error: '访问码与受理单归属机构不一致' }
  }
  const logs = q(`SELECT action,detail,operator,operator_side,time FROM ext_submission_logs
    WHERE submission_id=? ORDER BY id ASC`, s.id)
  return {
    submission: {
      code: s.code, org_name: s.org_name, partyType: s.party_type, partyText: EXT_PARTY[s.party_type] || s.party_type,
      kind: s.kind, kindText: EXT_KIND[s.kind] || s.kind, title: s.title, status: s.status, statusText: EXT_STATUS[s.status] || s.status,
      review_note: s.review_note, reply_note: s.reply_note, replied_by: s.replied_by, replied_at: s.replied_at,
      close_note: s.close_note, created: s.created, updated: s.updated
    },
    timeline: logs.map((l) => ({ ...l, actionText: LOG_TEXT[l.action] || l.action }))
  }
}

// ===== 内部审核工作台 =====
export function listSubmissions({ status = '', crisisId = null, partyType = '', kind = '', priority = '', limit = 200 } = {}) {
  let sql = `SELECT s.*, c.title crisis_title, wo.title wo_title
    FROM ext_submissions s LEFT JOIN crisis c ON c.id=s.crisis_id
    LEFT JOIN work_orders wo ON wo.id=s.work_order_id WHERE 1=1`
  const args = []
  if (status) { sql += ' AND s.status=?'; args.push(status) }
  if (crisisId) { sql += ' AND s.crisis_id=?'; args.push(crisisId) }
  if (partyType) { sql += ' AND s.party_type=?'; args.push(partyType) }
  if (kind) { sql += ' AND s.kind=?'; args.push(kind) }
  if (priority) { sql += ' AND s.priority=?'; args.push(priority) }
  sql += ' ORDER BY s.id DESC LIMIT ?'
  args.push(limit)
  return q(sql, ...args).map(decorate)
}

export function getSubmission(id) {
  const s = q1(`SELECT s.*, c.title crisis_title, c.status crisis_status, wo.title wo_title
    FROM ext_submissions s LEFT JOIN crisis c ON c.id=s.crisis_id
    LEFT JOIN work_orders wo ON wo.id=s.work_order_id WHERE s.id=?`, id)
  if (!s) return null
  const logs = q('SELECT * FROM ext_submission_logs WHERE submission_id=? ORDER BY id ASC', id)
    .map((l) => ({ ...l, actionText: LOG_TEXT[l.action] || l.action }))
  return { submission: decorate(s), logs }
}

// 看板汇总（角标/头部）
export function submissionSummary() {
  const counts = { pending: 0, reviewing: 0, approved: 0, rejected: 0, closed: 0 }
  for (const r of q('SELECT status, COUNT(*) c FROM ext_submissions GROUP BY status')) counts[r.status] = r.c
  const urgentOpen = q1("SELECT COUNT(*) c FROM ext_submissions WHERE priority='urgent' AND status IN ('pending','reviewing')").c
  const escalatedOpen = q1("SELECT COUNT(*) c FROM ext_submissions WHERE escalated=1 AND status IN ('pending','reviewing')").c
  const byParty = {}
  for (const r of q("SELECT party_type, COUNT(*) c FROM ext_submissions WHERE status IN ('pending','reviewing') GROUP BY party_type")) {
    byParty[r.party_type] = r.c
  }
  return { counts, open: counts.pending + counts.reviewing, urgentOpen, escalatedOpen, byParty }
}

// 危机维度外部协作摘要（危机卡片角标）
export function crisisExternalBrief(crisisId) {
  const open = q1("SELECT COUNT(*) c FROM ext_submissions WHERE crisis_id=? AND status IN ('pending','reviewing')", crisisId).c
  const total = q1('SELECT COUNT(*) c FROM ext_submissions WHERE crisis_id=?', crisisId).c
  const urgent = q1("SELECT COUNT(*) c FROM ext_submissions WHERE crisis_id=? AND priority='urgent' AND status IN ('pending','reviewing')", crisisId).c
  if (!total) return null
  return { open, total, urgent }
}

// 受理：待审核 → 审核中（ops+）
export function receiveSubmission(id, actor) {
  const s = q1('SELECT * FROM ext_submissions WHERE id=?', id)
  if (!s) return null
  if (s.status !== 'pending') return { error: `当前状态（${EXT_STATUS[s.status] || s.status}）不能受理` }
  const ts = now()
  run("UPDATE ext_submissions SET status='reviewing', received_by=?, received_at=COALESCE(received_at,?), updated=? WHERE id=? AND status='pending'",
    actor.user, ts, ts, id)
  addLog(id, 'receive', `${actor.user} 受理，进入内部审核`, actor.user, 'internal')
  return { ok: true }
}

// 审核采纳：审核中/待审核 → 已采纳；按勾选项回写工单、预警状态与危机统一时间线（admin）
// body: { note, create_work_order, work_order_id, wo_title, wo_category, wo_priority, wo_assignee, wo_sla_min, resolve_alerts, reply_note }
export function approveSubmission(id, body, actor) {
  const s = q1('SELECT * FROM ext_submissions WHERE id=?', id)
  if (!s) return null
  if (!ACTIVE_STATUS.includes(s.status)) return { error: `当前状态（${EXT_STATUS[s.status] || s.status}）不能审核采纳` }
  const b = body || {}
  const note = String(b.note || '').trim()
  const ts = now()
  let crisisId = s.crisis_id
  let woId = s.work_order_id ? +s.work_order_id : null
  let resolved = 0
  let createdWo = false

  if (b.crisis_id && !crisisId) {
    if (!q1('SELECT 1 FROM crisis WHERE id=?', +b.crisis_id)) return { error: '关联危机事件不存在' }
    crisisId = +b.crisis_id
  }

  db.exec('BEGIN')
  try {
    run("UPDATE ext_submissions SET status='approved', crisis_id=?, reviewed_by=?, reviewed_at=?, review_note=?, updated=? WHERE id=?",
      crisisId, actor.user, ts, note, ts, id)

    // 回写①：协同工单（新建或挂接既有）
    if (b.create_work_order && crisisId) {
      const r = createWorkOrder({
        crisis_id: crisisId,
        title: String(b.wo_title || '').trim() || `【外部·${EXT_PARTY[s.party_type]}】${s.title}`.slice(0, 80),
        detail: `由外部协作反馈门户受理单 ${s.code} 自动拆分\n提交方：${s.org_name}（${EXT_PARTY[s.party_type]}${s.contact_person ? ' · ' + s.contact_person : ''}）\n\n${s.content}` +
          (s.evidence_desc ? `\n\n证据/附件说明：${s.evidence_desc}` : '') + (s.evidence_url ? `\n材料链接：${s.evidence_url}` : ''),
        category: b.wo_category || (s.kind === 'inquiry' ? 'pr' : s.kind === 'directive' ? 'legal' : 'ops'),
        priority: b.wo_priority || (s.priority === 'urgent' ? 'urgent' : s.priority === 'high' ? 'high' : 'normal'),
        assignee: String(b.wo_assignee || '').trim(),
        sla_min: b.wo_sla_min != null ? +b.wo_sla_min : (s.priority === 'urgent' ? 60 : 240)
      }, actor)
      if (r.error) throw new Error(r.error)
      woId = r.id
      createdWo = true
      run('UPDATE ext_submissions SET work_order_id=? WHERE id=?', woId, id)
      addLog(id, 'workorder', `审核采纳：自动拆分协同工单 #${woId}`, actor.user, 'internal')
    } else if (b.work_order_id) {
      const wo = q1('SELECT * FROM work_orders WHERE id=?', +b.work_order_id)
      if (!wo) throw new Error('关联工单不存在')
      woId = wo.id
      if (crisisId && wo.crisis_id !== crisisId) throw new Error('关联工单与受理单危机事件不一致')
      run('UPDATE ext_submissions SET work_order_id=? WHERE id=?', woId, id)
    }
    if (woId) {
      logWorkOrder(woId, 'external',
        `外部协作门户回写：${EXT_PARTY[s.party_type]}「${s.org_name}」提交${EXT_KIND[s.kind]}《${s.title}》已采纳（受理单 ${s.code}，审核人：${actor.user}）`,
        actor, {})
    }

    // 回写②：联动解除该危机全部未解除预警（resolve_kind=external，状态守卫幂等）
    if (b.resolve_alerts && crisisId) {
      const opens = q("SELECT * FROM alert_events WHERE crisis_id=? AND status='open'", crisisId)
      for (const ev of opens) {
        run("UPDATE alert_events SET status='resolved', resolved=?, resolve_kind='external' WHERE id=? AND status='open'", ts, ev.id)
      }
      resolved = opens.length
      if (opens.length) addLog(id, 'resolve_alerts', `采纳联动：解除该危机 ${opens.length} 条未解除预警`, actor.user, 'internal')
    }

    // 回写③：危机统一时间线（带外部受理单锚点，看板可跳转）
    if (crisisId) {
      const c = q1('SELECT status FROM crisis WHERE id=?', crisisId)
      if (c && c.status !== 'closed') {
        const bits = [`${EXT_PARTY[s.party_type]}「${s.org_name}」提交${EXT_KIND[s.kind]}`]
        if (createdWo && woId) bits.push(`已拆分工单 #${woId}`)
        else if (woId) bits.push(`已回写工单 #${woId}`)
        if (resolved) bits.push(`同步解除 ${resolved} 条未解除预警`)
        const tlAction = s.kind === 'rectification' ? '外部整改反馈'
          : s.kind === 'directive' ? '监管整改通知'
            : s.kind === 'inquiry' ? '媒体问询' : '外部证据提交'
        addDispatchTimeline(crisisId, tlAction,
          `外部协作门户 · ${bits.join('，')}（受理单 ${s.code}）：${s.title}` + (note ? `；审核意见：${note}` : ''),
          { refType: 'external', refId: id, time: ts })
      }
    }

    addLog(id, 'approve', `审核采纳${note ? `：${note}` : ''}` +
      (woId ? `（工单 #${woId}）` : '') + (resolved ? `（解除 ${resolved} 条预警）` : ''), actor.user, 'internal')

    // 可选：采纳后直接给外部官方回复
    const reply = String(b.reply_note || '').trim()
    if (reply) {
      run('UPDATE ext_submissions SET reply_note=?, replied_by=?, replied_at=?, notified=1 WHERE id=?', reply, actor.user, ts, id)
      addLog(id, 'reply', `向${EXT_PARTY[s.party_type]}发出官方回复：${reply.slice(0, 80)}${reply.length > 80 ? '…' : ''}`, actor.user, 'internal')
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 已回滚 */ }
    return { error: String(e.message || e) }
  }
  return { ok: true, workOrderId: woId, createdWo, resolved }
}

// 审核退回：回到待审核/退回态，外部可补充材料后重新提交（admin）
export function rejectSubmission(id, body, actor) {
  const s = q1('SELECT * FROM ext_submissions WHERE id=?', id)
  if (!s) return null
  if (!ACTIVE_STATUS.includes(s.status)) return { error: `当前状态（${EXT_STATUS[s.status] || s.status}）不能退回` }
  const reason = String(body?.reason || '').trim()
  if (!reason) return { error: '请填写退回原因（外部提交方可见，据此补充材料）' }
  const ts = now()
  db.exec('BEGIN')
  try {
    run("UPDATE ext_submissions SET status='rejected', reviewed_by=?, reviewed_at=?, review_note=?, updated=? WHERE id=?",
      actor.user, ts, reason, ts, id)
    // 退回即给外部可见的官方回复，便于其按意见补正
    run('UPDATE ext_submissions SET reply_note=?, replied_by=?, replied_at=?, notified=1 WHERE id=?',
      `【退回补正】${reason}`, actor.user, ts, id)
    addLog(id, 'reject', `审核退回：${reason}（外部可补充材料后重新提交）`, actor.user, 'internal')
    if (s.crisis_id) {
      const c = q1('SELECT status FROM crisis WHERE id=?', s.crisis_id)
      if (c && c.status !== 'closed') {
        addDispatchTimeline(s.crisis_id, '外部反馈退回',
          `外部协作受理单 ${s.code}（${EXT_PARTY[s.party_type]}「${s.org_name}」）审核退回：${reason}`,
          { refType: 'external', refId: id, time: ts })
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 已回滚 */ }
    throw e
  }
  return { ok: true }
}

// 官方回复（ops+；任何非关闭状态可回复，可多次回复，门户侧可见）
export function replySubmission(id, body, actor) {
  const s = q1('SELECT * FROM ext_submissions WHERE id=?', id)
  if (!s) return null
  if (s.status === 'closed') return { error: '受理单已关闭，不能回复（如需继续请重新提交）' }
  const note = String(body?.note || '').trim()
  if (!note) return { error: '回复内容必填' }
  const ts = now()
  run('UPDATE ext_submissions SET reply_note=?, replied_by=?, replied_at=?, notified=1, updated=? WHERE id=?',
    note, actor.user, ts, ts, id)
  addLog(id, 'reply', `向${EXT_PARTY[s.party_type]}发出官方回复：${note.slice(0, 80)}${note.length > 80 ? '…' : ''}`, actor.user, 'internal')
  return { ok: true }
}

// 关闭（ops+；采纳/退回办结后关闭，关闭写时间线）
export function closeSubmission(id, body, actor) {
  const s = q1('SELECT * FROM ext_submissions WHERE id=?', id)
  if (!s) return null
  if (s.status === 'closed') return { error: '受理单已关闭' }
  const note = String(body?.note || '').trim() || '事项办结，关闭受理单'
  const ts = now()
  run("UPDATE ext_submissions SET status='closed', closed_by=?, closed_at=?, close_note=?, updated=? WHERE id=?",
    actor.user, ts, note, ts, id)
  addLog(id, 'close', `${actor.user} 关闭受理单：${note}`, actor.user, 'internal')
  if (s.crisis_id) {
    const c = q1('SELECT status FROM crisis WHERE id=?', s.crisis_id)
    if (c && c.status !== 'closed') {
      addDispatchTimeline(s.crisis_id, '外部协作关闭',
        `外部协作受理单 ${s.code}（${EXT_PARTY[s.party_type]}「${s.org_name}」）关闭：${note}`,
        { refType: 'external', refId: id, time: ts })
    }
  }
  return { ok: true }
}

export const LOG_TEXT = {
  submit: '门户提交', supplement: '补充材料', resubmit: '补正重提',
  receive: '内部受理', approve: '审核采纳', reject: '审核退回',
  reply: '官方回复', close: '关闭', escalate: '联动升级', workorder: '回写工单', resolve_alerts: '联动解除预警'
}

// 删除危机时保留外部受理单（对外承诺留痕），仅解除危机引用
export function detachCrisisExternal(crisisId) {
  run('UPDATE ext_submissions SET crisis_id=NULL WHERE crisis_id=?', crisisId)
}

// 复盘快照：外部协作受理情况（与各看板同口径 SQL 直查）
export function crisisExternalSnapshot(crisisId) {
  const rows = q('SELECT * FROM ext_submissions WHERE crisis_id=? ORDER BY id ASC', crisisId)
  return {
    total: rows.length,
    open: rows.filter((s) => ACTIVE_STATUS.includes(s.status)).length,
    approved: rows.filter((s) => s.status === 'approved').length,
    rejected: rows.filter((s) => s.status === 'rejected').length,
    closed: rows.filter((s) => s.status === 'closed').length,
    urgent: rows.filter((s) => s.priority === 'urgent').length,
    byParty: {
      brand: rows.filter((s) => s.party_type === 'brand').length,
      regulator: rows.filter((s) => s.party_type === 'regulator').length,
      media: rows.filter((s) => s.party_type === 'media').length
    },
    items: rows.map((s) => ({
      id: s.id, code: s.code, party_type: s.party_type, org_name: s.org_name, kind: s.kind,
      priority: s.priority, title: s.title, status: s.status, work_order_id: s.work_order_id,
      escalated: s.escalated, reviewed_by: s.reviewed_by, reviewed_at: s.reviewed_at, created: s.created
    }))
  }
}

void LV_TEXT
