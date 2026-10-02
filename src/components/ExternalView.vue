<template>
  <div class="ext">
    <div class="toolbar">
      <div class="seg">
        <button :class="{on: view === 'desk'}" @click="view='desk'">🛠 内部审核工作台</button>
        <button :class="{on: view === 'portal'}" @click="view='portal'">🌐 外部协作门户</button>
        <button v-if="canAdmin" :class="{on: view === 'contacts'}" @click="view='contacts'">📇 联络方名录</button>
      </div>
      <span class="me" v-if="view!=='portal'">👤 {{ store.user.name }} · {{ roleText(store.user.role) }}</span>
    </div>

    <!-- ============ 内部审核工作台 ============ -->
    <template v-if="view==='desk'">
      <p class="hint">
        🔗 品牌方/监管方/媒体经门户提交<b>证据材料、整改进度、媒体问询、监管整改通知</b>；值班员受理后由管理员审核——
        采纳可<b>回写协同工单（自动拆分/挂接）、联动解除预警、写入危机统一时间线</b>；监管紧急件自动<b>联动通知升级</b>（升级专线 + 回执超时升级）。
      </p>
      <div class="sum">
        <div class="sum-card pending"><b>{{ summary.counts?.pending || 0 }}</b><em>待审核</em></div>
        <div class="sum-card reviewing"><b>{{ summary.counts?.reviewing || 0 }}</b><em>审核中</em></div>
        <div class="sum-card urgent"><b>{{ summary.urgentOpen || 0 }}</b><em>紧急件在办</em></div>
        <div class="sum-card approved"><b>{{ summary.counts?.approved || 0 }}</b><em>已采纳</em></div>
        <div class="sum-card rejected"><b>{{ summary.counts?.rejected || 0 }}</b><em>已退回</em></div>
        <div class="sum-card closed"><b>{{ summary.counts?.closed || 0 }}</b><em>已关闭</em></div>
      </div>

      <div class="filters">
        <button class="chip" :class="{on: !filter.status}" @click="setFilter('status','')">全部</button>
        <button v-for="(t,k) in dict.status" :key="k" class="chip" :class="[k,{on:filter.status===k}]" @click="setFilter('status',k)">
          {{ t }} {{ summary.counts?.[k] || 0 }}
        </button>
        <span class="sep"></span>
        <select v-model="filter.party_type" class="mini-sel" @change="load">
          <option value="">全部提交方</option>
          <option v-for="(t,k) in dict.party" :key="k" :value="k">{{ t }}</option>
        </select>
        <select v-model="filter.kind" class="mini-sel" @change="load">
          <option value="">全部类型</option>
          <option v-for="(t,k) in dict.kind" :key="k" :value="k">{{ t }}</option>
        </select>
        <select v-model="filter.crisis_id" class="mini-sel wide" @change="load">
          <option value="">全部危机</option>
          <option v-for="c in crises" :key="c.id" :value="c.id">#{{ c.id }} {{ c.title }}</option>
        </select>
        <button class="refresh" @click="load">🔄</button>
      </div>

      <div v-if="!items.length" class="none">暂无外部协作受理单</div>
      <div class="list">
        <div v-for="s in items" :key="s.id" class="s-card" :class="[s.status, s.party_type, {hl: highlightId===s.id, urgent: s.priority==='urgent' && ['pending','reviewing'].includes(s.status)}]">
          <div class="s-head">
            <span class="party">{{ iconOf(s.party_type) }} {{ s.partyText }}</span>
            <span class="kind">{{ s.kindText }}</span>
            <span class="pri" :class="s.priority">{{ s.priorityText }}</span>
            <b class="s-title">{{ s.title }}</b>
            <span class="code">{{ s.code }}</span>
            <span class="st" :class="s.status">{{ s.statusText }}</span>
          </div>
          <div class="s-sub">
            <span>🏢 {{ s.org_name }}<i v-if="s.contact_person"> · {{ s.contact_person }}</i><i v-if="s.contact"> · {{ s.contact }}</i></span>
            <span v-if="s.crisis_id" class="crisis-tag" @click="gotoCrisis(s)">🛟 危机 #{{ s.crisis_id }} {{ s.crisis_title }} →</span>
            <span v-if="s.work_order_id" class="wo-tag" @click="gotoWorkOrder(s)">📋 工单 #{{ s.work_order_id }} {{ s.wo_title }} →</span>
            <span v-if="s.escalated && ['pending','reviewing'].includes(s.status)" class="esc-tag">🚨 已联动升级</span>
            <span class="time">{{ s.updated }}</span>
          </div>
          <pre class="content-text">{{ s.content }}</pre>
          <div v-if="s.evidence_desc || s.evidence_url" class="evidence">
            📎 {{ s.evidence_desc || '证据材料' }}
            <a v-if="s.evidence_url" :href="s.evidence_url" target="_blank" rel="noopener" class="ev-link">查看材料 ↗</a>
          </div>

          <div v-if="s.review_note" class="review-box" :class="{rej: s.status==='rejected'}">
            <b>{{ s.status==='rejected' ? '↩ 退回意见' : '✔ 审核意见' }}（{{ s.reviewed_by }}）：</b>{{ s.review_note }}
          </div>
          <div v-if="s.reply_note" class="reply-box">📨 官方回复（{{ s.replied_by }} · {{ s.replied_at }}）：{{ s.reply_note }}</div>

          <!-- 操作区 -->
          <div class="ops">
            <button class="op" @click="toggleLogs(s)">📜 全程留痕</button>
            <template v-if="['pending','reviewing','approved','rejected'].includes(s.status)">
              <button v-if="s.status==='pending' && canOps" class="op recv" @click="doReceive(s)">📥 受理</button>
              <button v-if="canAdmin && ['pending','reviewing'].includes(s.status)" class="op approve" @click="openApprove(s)">✔ 审核采纳…</button>
              <button v-if="canAdmin && ['pending','reviewing'].includes(s.status)" class="op reject" @click="doReject(s)">↩ 退回补正</button>
              <button v-if="canOps" class="op reply" @click="doReply(s)">📨 官方回复</button>
              <button v-if="canOps && s.status!=='pending'" class="op close" @click="doClose(s)">🔒 关闭</button>
            </template>
            <span v-else-if="s.status==='closed'" class="closed-note">已关闭{{ s.close_note ? '：' + s.close_note : '' }}（{{ s.closed_by }} · {{ s.closed_at }}）</span>
          </div>

          <!-- 留痕时间线 -->
          <div v-if="openLogsId===s.id" class="logs">
            <div v-for="l in logsOf[s.id] || []" :key="l.id" class="log" :class="l.operator_side">
              <span class="lg-side">{{ l.operator_side === 'external' ? '外部' : '内部' }}</span>
              <b>{{ l.actionText }}</b>
              <span class="lg-detail">{{ l.detail }}</span>
              <em>{{ l.operator }} · {{ l.time }}</em>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 外部协作门户（对外提交/查询） ============ -->
    <template v-if="view==='portal'">
      <div class="portal-banner">
        <div>
          <h3>🤝 外部协作反馈门户</h3>
          <p>品牌方、监管方与媒体可通过本门户提交证据材料、整改进度与问询；内部审核后，办理状态与官方回复将在此实时反馈。</p>
        </div>
        <div class="portal-tabs">
          <button :class="{on: ptab==='submit'}" @click="ptab='submit'">📤 提交材料</button>
          <button :class="{on: ptab==='track'}" @click="ptab='track'">🔎 进度查询</button>
        </div>
      </div>

      <!-- 提交表单 -->
      <form v-if="ptab==='submit'" class="p-form" @submit.prevent="doPortalSubmit">
        <div class="p-tip">如已收到我方发放的<b>访问码</b>，请填写以自动带出机构信息（如 监管方演示码 <code>REG-8801</code>、品牌方 <code>BR-2046</code>、媒体 <code>MED-6107</code>）；无访问码可作为访客提交。</div>
        <div class="row">
          <input v-model="pform.access_code" placeholder="访问码（可选，如 REG-8801）" style="max-width:220px" />
          <select v-model="pform.party_type" style="max-width:130px">
            <option value="brand">🏪 品牌方</option>
            <option value="regulator">⚖️ 监管方</option>
            <option value="media">📰 媒体</option>
          </select>
          <select v-model="pform.kind">
            <option v-for="(t,k) in portalKinds" :key="k" :value="k">{{ t }}</option>
          </select>
          <select v-model="pform.priority" style="max-width:110px">
            <option value="normal">普通</option>
            <option value="high">高</option>
            <option value="urgent">紧急</option>
          </select>
        </div>
        <div class="row">
          <input v-model="pform.org_name" placeholder="机构名称（无访问码时填写）" />
          <input v-model="pform.contact_person" placeholder="联系人" style="max-width:160px" />
          <input v-model="pform.contact" placeholder="联系电话/邮箱" style="max-width:220px" />
        </div>
        <input v-model="pform.title" placeholder="标题，如 门店整改完成情况报告 / 采访问询" required />
        <textarea v-model="pform.content" class="content" placeholder="请详细描述证据情况、整改进度或问询事项…" required></textarea>
        <div class="row">
          <input v-model="pform.evidence_desc" placeholder="证据/附件说明（文件名、份数、摘要）" />
          <input v-model="pform.evidence_url" placeholder="材料链接（可选）" />
        </div>
        <div class="row">
          <label class="crisis-opt" title="演示：外部可指定材料关联的公开事件；不确定可留空">
            关联危机事件（可选）：
            <select v-model.number="pform.crisis_id">
              <option :value="null">不指定（由内部审核挂接）</option>
              <option v-for="c in openCrises" :key="c.id" :value="c.id">#{{ c.id }} {{ c.title }}</option>
            </select>
          </label>
        </div>
        <div class="row">
          <button class="save" type="submit">提交至内部审核</button>
          <button type="button" class="ghost" @click="resetPForm">清空</button>
        </div>
        <div v-if="submitResult" class="submit-result">
          ✅ 提交成功，受理编号 <b>{{ submitResult.code }}</b>，请凭此编号与访问码在「进度查询」中跟踪办理状态与官方回复。
          <button class="op reply" @click="gotoTrack(submitResult.code)">立即查询 →</button>
        </div>
      </form>

      <!-- 进度查询 -->
      <div v-if="ptab==='track'" class="p-track">
        <div class="track-bar">
          <input v-model="trackForm.code" placeholder="受理编号，如 EXT-20261002-1002" />
          <input v-model="trackForm.access_code" placeholder="访问码（登记机构必填，如 REG-8801）" />
          <button class="save" @click="doTrack">查询</button>
        </div>
        <div v-if="trackError" class="track-err">⚠️ {{ trackError }}</div>
        <div v-if="trackData" class="track-result">
          <div class="tr-head">
            <b>{{ iconOf(trackData.submission.partyType) }} {{ trackData.submission.title }}</b>
            <span class="code">{{ trackData.submission.code }}</span>
            <span class="st" :class="trackData.submission.status">{{ trackData.submission.statusText }}</span>
          </div>
          <div class="tr-sub">{{ trackData.submission.partyText }} · {{ trackData.submission.kindText }} · 提交于 {{ trackData.submission.created }}</div>
          <div v-if="trackData.submission.reply_note" class="reply-box public">
            📨 <b>官方回复（{{ trackData.submission.replied_by }} · {{ trackData.submission.replied_at }}）：</b>{{ trackData.submission.reply_note }}
          </div>
          <div v-if="trackData.submission.status==='rejected' && trackData.submission.review_note" class="review-box rej">
            ↩ <b>退回意见：</b>{{ trackData.submission.review_note }}——请补充材料后通过下方入口重新提交
          </div>
          <h5>办理进度</h5>
          <div class="tl">
            <div v-for="(l,i) in trackData.timeline" :key="i" class="tl-item" :class="l.operator_side">
              <span class="tl-dot"></span>
              <div class="tl-body">
                <b>{{ l.actionText }}<i class="side-tag">{{ l.operator_side === 'external' ? '外部' : '内部' }}</i></b>
                <span>{{ l.detail }}</span>
                <em>{{ l.operator }} · {{ l.time }}</em>
              </div>
            </div>
          </div>
          <!-- 退回补正：凭编号 + 访问码补充材料 -->
          <div v-if="trackData.submission.status==='rejected'" class="supplement">
            <h5>补充材料后重新提交</h5>
            <textarea v-model="suppForm.content" class="content sm" placeholder="请按退回意见补充说明…"></textarea>
            <div class="row">
              <input v-model="suppForm.evidence_desc" placeholder="补充附件说明（可选）" />
              <input v-model="suppForm.evidence_url" placeholder="补充材料链接（可选）" />
            </div>
            <button class="save" @click="doSupplement">补充并重新提交</button>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 联络方名录（admin） ============ -->
    <template v-if="view==='contacts'">
      <p class="hint">📇 维护品牌方/监管方/媒体联络机构与<b>门户访问码</b>；外部凭访问码提交时自动继承机构身份并可查询名下受理单。访问码可重置（重置后旧码失效）。</p>
      <div class="toolbar">
        <button class="add" @click="openContactForm()">＋ 新增联络方</button>
        <input v-model="contactKw" class="kw" placeholder="搜索机构/联系人/访问码" @keyup.enter="loadContacts" />
        <button class="op" @click="loadContacts">搜索</button>
      </div>
      <form v-if="contactForm.open" class="c-form" @submit.prevent="saveContact">
        <div class="row">
          <input v-model="contactForm.name" placeholder="机构名称" required />
          <select v-model="contactForm.party_type" style="max-width:130px">
            <option value="brand">🏪 品牌方</option>
            <option value="regulator">⚖️ 监管方</option>
            <option value="media">📰 媒体</option>
          </select>
        </div>
        <div class="row">
          <input v-model="contactForm.contact_person" placeholder="联系人" />
          <input v-model="contactForm.contact" placeholder="联系电话/邮箱" />
        </div>
        <textarea v-model="contactForm.note" placeholder="备注（对口处室/整改主体/报道栏目等）"></textarea>
        <div class="row">
          <button class="save" type="submit">{{ contactForm.id ? '保存修改' : '创建并生成访问码' }}</button>
          <button type="button" class="ghost" @click="contactForm.open=false">取消</button>
        </div>
      </form>
      <table class="ct-table">
        <thead><tr><th>机构</th><th>类型</th><th>联系人</th><th>联系方式</th><th>访问码</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="c in contacts" :key="c.id">
            <td><b>{{ c.name }}</b><small v-if="c.note"> · {{ c.note }}</small></td>
            <td>{{ iconOf(c.party_type) }} {{ c.partyText }}</td>
            <td>{{ c.contact_person || '—' }}</td>
            <td>{{ c.contact || '—' }}</td>
            <td><code class="access-code">{{ c.access_code }}</code></td>
            <td><span class="en" :class="{off:!c.enabled}">{{ c.enabled ? '启用' : '停用' }}</span></td>
            <td class="ct-ops">
              <button class="op sm" @click="openContactForm(c)">编辑</button>
              <button class="op sm" @click="doResetCode(c)">重置访问码</button>
              <button class="op sm" @click="doToggleContact(c)">{{ c.enabled ? '停用' : '启用' }}</button>
              <button class="op sm reject" @click="doDelContact(c)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 审核采纳弹窗 -->
    <div v-if="approveForm.open" class="modal-mask" @click.self="approveForm.open=false">
      <div class="modal">
        <h4>✔ 审核采纳 · {{ approveForm.code }}</h4>
        <p class="m-sub">{{ iconOf(approveForm.party_type) }} {{ approveForm.org }} — {{ approveForm.title }}</p>
        <label class="m-field">审核意见（写入留痕与危机时间线）
          <textarea v-model="approveForm.note" placeholder="如：证据齐全，整改情况属实，予以采纳…"></textarea>
        </label>
        <label class="m-field">关联危机事件
          <select v-model.number="approveForm.crisis_id">
            <option :value="null">不关联</option>
            <option v-for="c in crises" :key="c.id" :value="c.id">#{{ c.id }} {{ c.title }}（{{ c.status==='closed' ? '已结案' : '在办' }}）</option>
          </select>
        </label>
        <div class="m-opt" :class="{disabled: !approveForm.crisis_id}">
          <label><input type="checkbox" v-model="approveForm.create_work_order" :disabled="!approveForm.crisis_id" /> 采纳时自动拆分协同工单</label>
          <div v-if="approveForm.create_work_order && approveForm.crisis_id" class="wo-fields">
            <input v-model="approveForm.wo_title" placeholder="工单标题（默认按受理单生成）" />
            <div class="row">
              <select v-model="approveForm.wo_category">
                <option value="pr">公关口径</option>
                <option value="legal">法务合规</option>
                <option value="ops">现场运营</option>
                <option value="support">客诉跟进</option>
                <option value="other">其他</option>
              </select>
              <select v-model="approveForm.wo_priority">
                <option value="urgent">紧急</option>
                <option value="high">高</option>
                <option value="normal">普通</option>
              </select>
              <input v-model="approveForm.wo_assignee" placeholder="指派处理人（可留空待认领）" />
              <input v-model.number="approveForm.wo_sla_min" type="number" min="0" placeholder="SLA 分钟（0=无时限）" style="max-width:150px" />
            </div>
          </div>
          <label v-if="!approveForm.create_work_order"><input type="checkbox" v-model="approveForm.linkExisting" :disabled="!approveForm.crisis_id" /> 挂接到既有工单
            <select v-model.number="approveForm.work_order_id" :disabled="!approveForm.linkExisting || !approveForm.crisis_id">
              <option :value="null">选择工单</option>
              <option v-for="w in crisisWorkOrders" :key="w.id" :value="w.id">#{{ w.id }} {{ w.title }}（{{ w.statusText }}）</option>
            </select>
          </label>
          <label><input type="checkbox" v-model="approveForm.resolve_alerts" :disabled="!approveForm.crisis_id" /> 联动解除该危机下全部未解除预警</label>
        </div>
        <label class="m-field">官方回复（可选，采纳后直接回复提交方，门户可见）
          <textarea v-model="approveForm.reply_note" placeholder="如：材料已收悉并审核通过，我们将按此推进整改并安排复查…"></textarea>
        </label>
        <div class="m-actions">
          <button class="ghost" @click="approveForm.open=false">取消</button>
          <button class="save" @click="doApprove">确认采纳并回写</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { usePubStore } from '@/store/pub'
const store = usePubStore()

const view = ref('desk')
const ptab = ref('submit')
const items = ref([])
const contacts = ref([])
const summary = ref({ counts: {} })
const dict = reactive({ status: {}, party: {}, kind: {}, priority: {} })
const crises = ref([])
const openCrises = computed(() => store.crises.filter((c) => c.status !== 'closed'))
const crisisWorkOrders = ref([])
const filter = reactive({ status: '', party_type: '', kind: '', crisis_id: '' })
const highlightId = ref(null)
const openLogsId = ref(null)
const logsOf = reactive({})
const contactKw = ref('')
const contactForm = reactive({ open: false })
const portalKinds = { evidence: '证据材料', rectification: '整改进度', inquiry: '媒体问询', directive: '监管整改通知' }

const canOps = computed(() => ['admin', 'ops'].includes(store.user.role))
const canAdmin = computed(() => store.user.role === 'admin')
function roleText(r) { return ({ admin: '管理员', ops: '值班员', viewer: '观察员' })[r] || r }
function iconOf(t) { return ({ brand: '🏪', regulator: '⚖️', media: '📰' })[t] || '📨' }

async function load() {
  const d = await store.fetchExternal({
    status: filter.status, party_type: filter.party_type, kind: filter.kind,
    crisis_id: filter.crisis_id || ''
  })
  items.value = d.items
  Object.assign(summary.value, d.summary)
  Object.assign(dict, d.dict)
  crises.value = d.crises
  if (store.extCrisisFilter) { filter.crisis_id = store.extCrisisFilter; store.extCrisisFilter = null; return load() }
}
function setFilter(k, v) { filter[k] = v; load() }

async function toggleLogs(s) {
  if (openLogsId.value === s.id) { openLogsId.value = null; return }
  const d = await store.fetchExternalSubmission(s.id)
  logsOf[s.id] = d.logs
  openLogsId.value = s.id
}
async function doReceive(s) {
  try { await store.receiveExternal(s.id); await load(); await refreshOpen(s.id) } catch (e) { store.msg(e.message, 'warn') }
}
async function refreshOpen(id) { if (openLogsId.value === id) { const d = await store.fetchExternalSubmission(id); logsOf[id] = d.logs } }

// 审核采纳弹窗
const approveForm = reactive({ open: false })
function openApprove(s) {
  Object.assign(approveForm, {
    open: true, id: s.id, code: s.code, org: s.org_name, party_type: s.party_type, title: s.title,
    note: '', crisis_id: s.crisis_id || null, create_work_order: !s.work_order_id, linkExisting: !!s.work_order_id,
    work_order_id: s.work_order_id || null, wo_title: '', wo_category: s.kind === 'inquiry' ? 'pr' : s.kind === 'directive' ? 'legal' : 'ops',
    wo_priority: s.priority === 'urgent' ? 'urgent' : s.priority === 'high' ? 'high' : 'normal',
    wo_assignee: '', wo_sla_min: s.priority === 'urgent' ? 60 : 240,
    resolve_alerts: s.kind === 'rectification', reply_note: ''
  })
  loadCrisisWorkOrders()
}
async function loadCrisisWorkOrders() {
  if (!approveForm.crisis_id) { crisisWorkOrders.value = []; return }
  const d = await store.fetchWorkOrders({ crisis_id: approveForm.crisis_id })
  crisisWorkOrders.value = d.items.filter((w) => !['cancelled'].includes(w.status))
}
import { watch } from 'vue'
watch(() => approveForm.crisis_id, loadCrisisWorkOrders)
async function doApprove() {
  try {
    const body = {
      note: approveForm.note, crisis_id: approveForm.crisis_id,
      create_work_order: approveForm.create_work_order,
      work_order_id: approveForm.linkExisting && !approveForm.create_work_order ? approveForm.work_order_id : null,
      wo_title: approveForm.wo_title, wo_category: approveForm.wo_category, wo_priority: approveForm.wo_priority,
      wo_assignee: approveForm.wo_assignee, wo_sla_min: approveForm.wo_sla_min,
      resolve_alerts: approveForm.resolve_alerts, reply_note: approveForm.reply_note
    }
    await store.approveExternal(approveForm.id, body)
    approveForm.open = false
    await load()
  } catch (e) { store.msg(e.message, 'warn') }
}
async function doReject(s) {
  const reason = prompt(`退回受理单 ${s.code}：\n退回原因（提交方在门户可见，据此补充材料重新提交）：`, '请补充相关证明材料后重新提交')
  if (reason == null || !reason.trim()) return
  try { await store.rejectExternal(s.id, reason.trim()); await load(); await refreshOpen(s.id) } catch (e) { store.msg(e.message, 'warn') }
}
async function doReply(s) {
  const note = prompt(`向 ${s.org_name} 官方回复（受理单 ${s.code}）：`, s.reply_note || '')
  if (note == null || !note.trim()) return
  try { await store.replyExternal(s.id, note.trim()); await load(); await refreshOpen(s.id) } catch (e) { store.msg(e.message, 'warn') }
}
async function doClose(s) {
  const note = prompt(`关闭受理单 ${s.code}：\n关闭说明（可留空）：`, '事项办结')
  if (note == null) return
  try { await store.closeExternal(s.id, note.trim()); await load(); await refreshOpen(s.id) } catch (e) { store.msg(e.message, 'warn') }
}
function gotoCrisis(s) { store.tab = 'crisis' }
function gotoWorkOrder(s) { store.tab = 'work' }

// ===== 门户提交 =====
const pform = reactive({})
function resetPForm() {
  Object.assign(pform, { access_code: '', party_type: 'brand', kind: 'evidence', priority: 'normal', org_name: '', contact_person: '', contact: '', title: '', content: '', evidence_desc: '', evidence_url: '', crisis_id: null })
}
resetPForm()
const submitResult = ref(null)
async function doPortalSubmit() {
  submitResult.value = null
  try {
    const r = await store.portalSubmit({ ...pform, crisis_id: pform.crisis_id || undefined })
    submitResult.value = r
    store.msg(r.urgent ? '紧急监管件已提交并联动通知升级' : '提交成功，待内部审核', 'success')
    resetPForm()
  } catch (e) { store.msg(e.message, 'warn') }
}
function gotoTrack(code) { ptab.value = 'track'; trackForm.code = code; doTrack() }

// ===== 门户查询 =====
const trackForm = reactive({ code: '', access_code: '' })
const trackData = ref(null)
const trackError = ref('')
const suppForm = reactive({ content: '', evidence_desc: '', evidence_url: '' })
async function doTrack() {
  trackData.value = null; trackError.value = ''
  try { trackData.value = await store.portalTrack(trackForm.code.trim(), trackForm.access_code.trim()) }
  catch (e) { trackError.value = e.message }
}
async function doSupplement() {
  if (!suppForm.content.trim()) { store.msg('补充内容必填', 'warn'); return }
  try {
    await store.portalSupplement({ code: trackForm.code.trim(), access_code: trackForm.access_code.trim(), ...suppForm })
    store.msg('补充材料已提交，受理单重新进入待审核', 'success')
    suppForm.content = ''; suppForm.evidence_desc = ''; suppForm.evidence_url = ''
    await doTrack()
  } catch (e) { store.msg(e.message, 'warn') }
}

// ===== 联络方名录 =====
async function loadContacts() {
  contacts.value = await store.fetchExternalContacts()
  if (contactKw.value) {
    const d = await store.fetchExternalContacts()
    void d
  }
}
function openContactForm(c) {
  if (c) Object.assign(contactForm, { open: true, ...c })
  else Object.assign(contactForm, { open: true, id: null, name: '', party_type: 'brand', contact_person: '', contact: '', note: '' })
}
async function saveContact() {
  try {
    if (contactForm.id) await store.updateExternalContact(contactForm.id, contactForm)
    else await store.saveExternalContact(contactForm)
    contactForm.open = false
    await loadContacts()
  } catch (e) { store.msg(e.message, 'warn') }
}
async function doResetCode(c) {
  if (!confirm(`确认为「${c.name}」重置访问码？重置后旧访问码立即失效。`)) return
  try { await store.resetExternalCode(c.id); await loadContacts() } catch (e) { store.msg(e.message, 'warn') }
}
async function doToggleContact(c) {
  try { await store.toggleExternalContact(c.id); await loadContacts() } catch (e) { store.msg(e.message, 'warn') }
}
async function doDelContact(c) {
  if (!confirm(`删除联络方「${c.name}」？历史受理单将保留机构快照。`)) return
  try { await store.delExternalContact(c.id); await loadContacts() } catch (e) { store.msg(e.message, 'warn') }
}

let timer = null
onMounted(async () => {
  if (store.extOpenId) {
    const id = store.extOpenId
    store.extOpenId = null
    highlightId.value = id
    setTimeout(() => { highlightId.value = null }, 4000)
  }
  await Promise.all([load(), loadContacts()])
  timer = setInterval(() => { if (view.value === 'desk') load() }, 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.ext{display:flex;flex-direction:column;gap:12px;}
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.seg{display:flex;background:#0c1730;border:1px solid rgba(120,160,220,0.2);border-radius:10px;padding:3px;gap:2px;}
.seg button{background:none;border:none;color:#8ba2c8;padding:7px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;}
.seg button.on{background:linear-gradient(135deg,#5c6bc0,#283593);color:#fff;font-weight:600;}
.me{margin-left:auto;font-size:11px;color:#8ba2c8;background:#13233f;border:1px solid rgba(120,160,220,0.2);border-radius:8px;padding:6px 12px;}
.hint{margin:0;font-size:11px;color:#5b6f94;line-height:1.7;}
.hint b{color:#9fa8da;font-weight:600;}
.sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;}
.sum-card{background:#0f1b38;border:1px solid rgba(120,160,220,0.16);border-radius:10px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:2px;border-top:3px solid #546e7a;}
.sum-card b{font-size:22px;color:#fff;}.sum-card em{font-size:10px;color:#8ba2c8;font-style:normal;}
.sum-card.pending{border-top-color:#ffb300;}.sum-card.reviewing{border-top-color:#42a5f5;}
.sum-card.urgent{border-top-color:#ef5350;}.sum-card.approved{border-top-color:#66bb6a;}
.sum-card.rejected{border-top-color:#ff7043;}.sum-card.closed{border-top-color:#78909c;}
.filters{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
.chip{background:#0f1b38;border:1px solid rgba(120,160,220,0.18);color:#8ba2c8;border-radius:14px;padding:4px 12px;font-size:11px;cursor:pointer;font-family:inherit;}
.chip.on{border-color:#5c6bc0;color:#fff;background:#1a2350;}
.chip.pending.on{border-color:#ffb300;background:#33270e;color:#ffe082;}
.chip.reviewing.on{border-color:#42a5f5;background:#0d2137;color:#90caf9;}
.chip.approved.on{border-color:#66bb6a;background:#14261a;color:#a5d6a7;}
.chip.rejected.on{border-color:#ff7043;background:#331a12;color:#ffab91;}
.chip.closed.on{border-color:#78909c;background:#263238;color:#cfd8dc;}
.sep{width:1px;height:18px;background:rgba(120,160,220,0.2);margin:0 4px;}
.mini-sel{background:#0f1b38;border:1px solid rgba(120,160,220,0.2);color:#aebadd;border-radius:7px;padding:5px 8px;font-size:11px;font-family:inherit;}
.mini-sel.wide{max-width:240px;}
.refresh{background:#0f1b38;border:1px solid rgba(120,160,220,0.2);border-radius:7px;color:#8ba2c8;cursor:pointer;padding:5px 10px;}
.none{color:#5b6f94;text-align:center;padding:32px;}
.list{display:flex;flex-direction:column;gap:12px;}
.s-card{background:#0f1b38;border:1px solid rgba(120,160,220,0.16);border-left:4px solid #546e7a;border-radius:10px;padding:13px 15px;}
.s-card.brand{border-left-color:#5c6bc0;}.s-card.regulator{border-left-color:#ab47bc;}.s-card.media{border-left-color:#26a69a;}
.s-card.pending{box-shadow:0 0 0 1px rgba(255,179,0,.08);}
.s-card.urgent{box-shadow:0 0 0 1px rgba(239,83,80,.35);}
.s-card.approved{opacity:.92;}.s-card.closed{opacity:.7;}
.s-card.hl{animation:hlflash 1.2s ease-in-out 3;}
@keyframes hlflash{0%,100%{box-shadow:0 0 0 0 rgba(92,107,192,0);}50%{box-shadow:0 0 0 2px rgba(92,107,192,.65);}}
.s-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.party{font-size:11px;font-weight:700;color:#c5cae9;background:#1a2350;border:1px solid rgba(124,134,226,.35);border-radius:6px;padding:2px 9px;}
.s-card.regulator .party{color:#e1bee7;background:#2b1640;border-color:rgba(171,71,188,.4);}
.s-card.media .party{color:#80cbc4;background:#0d302c;border-color:rgba(38,166,154,.4);}
.kind{font-size:10px;color:#8ba2c8;background:#16263f;border-radius:6px;padding:2px 8px;}
.pri{font-size:10px;padding:2px 8px;border-radius:6px;background:#16263f;color:#8ba2c8;}
.pri.urgent{background:#4a1518;color:#ef9a9a;}.pri.high{background:#33230e;color:#ffcc80;}
.s-title{color:#fff;font-size:13px;flex:1;min-width:180px;}
.code{font-size:10px;color:#9fa8da;font-family:monospace;background:#10183f;border:1px solid rgba(124,134,226,.3);border-radius:5px;padding:1px 7px;}
.st{font-size:10px;padding:2px 9px;border-radius:6px;background:#263238;color:#b0bec5;}
.st.pending{background:#33270e;color:#ffe082;}.st.reviewing{background:#0d2137;color:#90caf9;}
.st.approved{background:#1b5e20;color:#a5d6a7;}.st.rejected{background:#3e1f14;color:#ffab91;}.st.closed{background:#263238;color:#90a4ae;}
.s-sub{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:7px;font-size:10px;color:#5b6f94;}
.s-sub i{color:#8ba2c8;font-style:normal;}
.crisis-tag,.wo-tag{font-size:10px;color:#90caf9;background:#0d2137;border:1px solid rgba(144,202,249,.3);border-radius:5px;padding:2px 8px;cursor:pointer;}
.wo-tag{color:#80cbc4;border-color:rgba(38,166,154,.35);background:#0d2b28;}
.esc-tag{font-size:10px;color:#ef9a9a;background:#4a1518;border:1px solid rgba(239,83,80,.4);border-radius:5px;padding:2px 8px;font-weight:700;}
.time{margin-left:auto;}
.content-text{white-space:pre-wrap;margin:8px 0 0;color:#c6d2e8;font-size:12px;line-height:1.7;background:#0c1730;border:1px solid rgba(120,160,220,0.1);border-radius:8px;padding:9px 11px;max-height:150px;overflow-y:auto;font-family:inherit;}
.evidence{margin-top:7px;font-size:10px;color:#8ba2c8;background:#101f3a;border:1px dashed rgba(120,160,220,.25);border-radius:7px;padding:6px 10px;}
.ev-link{color:#80cbc4;margin-left:8px;}
.review-box{margin-top:7px;font-size:11px;color:#a5d6a7;background:#12261a;border:1px solid rgba(102,187,106,.3);border-radius:8px;padding:7px 11px;line-height:1.6;}
.review-box.rej{color:#ffab91;background:#3e2723;border-color:rgba(255,138,101,.35);}
.reply-box{margin-top:7px;font-size:11px;color:#90caf9;background:#0d2137;border:1px solid rgba(144,202,249,.25);border-radius:8px;padding:7px 11px;line-height:1.6;}
.reply-box.public{font-size:12px;padding:10px 12px;}
.ops{display:flex;gap:7px;margin-top:9px;flex-wrap:wrap;align-items:center;}
.op{background:none;border:1px solid rgba(120,160,220,.4);color:#aebadd;cursor:pointer;border-radius:7px;padding:5px 12px;font-size:11px;font-family:inherit;}
.op.sm{padding:3px 9px;font-size:10px;}
.op.recv{border-color:rgba(66,165,245,.5);color:#90caf9;}
.op.approve{border-color:rgba(102,187,106,.6);color:#a5d6a7;background:rgba(27,94,32,.25);font-weight:600;}
.op.reject{border-color:rgba(239,83,80,.5);color:#ef9a9a;}
.op.reply{border-color:rgba(66,165,245,.45);color:#90caf9;}
.op.close{border-color:rgba(144,164,174,.45);color:#b0bec5;}
.closed-note{font-size:10px;color:#78909c;}
.logs{margin-top:8px;border-top:1px dashed rgba(120,160,220,0.15);padding-top:8px;display:flex;flex-direction:column;gap:5px;max-height:230px;overflow-y:auto;}
.log{display:flex;align-items:baseline;gap:8px;font-size:10px;color:#8ba2c8;flex-wrap:wrap;}
.lg-side{flex:none;font-size:9px;padding:1px 6px;border-radius:4px;background:#16263f;color:#90caf9;}
.log.external .lg-side{background:#33270e;color:#ffcc80;}
.log b{color:#dbe4f3;font-size:10px;}
.lg-detail{flex:1;min-width:200px;}
.log em{color:#5b6f94;font-style:normal;font-size:9px;white-space:nowrap;}
/* 门户 */
.portal-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;background:linear-gradient(135deg,#1a2350,#0d302c);border:1px solid rgba(124,134,226,.3);border-radius:14px;padding:18px 22px;flex-wrap:wrap;}
.portal-banner h3{margin:0 0 6px;color:#fff;font-size:17px;}
.portal-banner p{margin:0;font-size:12px;color:#aebadd;max-width:640px;line-height:1.7;}
.portal-tabs{display:flex;gap:8px;}
.portal-tabs button{background:rgba(13,33,55,.8);border:1px solid rgba(120,160,220,.3);color:#aebadd;border-radius:9px;padding:9px 18px;cursor:pointer;font-size:13px;font-family:inherit;}
.portal-tabs button.on{background:linear-gradient(135deg,#26a69a,#283593);color:#fff;border-color:transparent;font-weight:600;}
.p-form,.p-track,.c-form{background:#0f1b38;border:1px solid rgba(120,160,220,0.16);border-radius:12px;padding:15px;display:flex;flex-direction:column;gap:9px;}
.p-tip{font-size:11px;color:#8ba2c8;background:#0c1730;border:1px dashed rgba(120,160,220,.25);border-radius:8px;padding:9px 12px;line-height:1.7;}
.p-tip code,.access-code{background:#10183f;color:#9fa8da;padding:1px 6px;border-radius:4px;font-size:10px;border:1px solid rgba(124,134,226,.3);}
.row{display:flex;gap:8px;flex-wrap:wrap;}
.row input,.row select{flex:1;min-width:120px;}
input,select,textarea,button{font-family:inherit;background:#13233f;border:1px solid rgba(120,160,220,0.2);color:#dbe4f3;border-radius:8px;padding:8px 10px;font-size:12px;}
textarea{resize:vertical;min-height:52px;}
textarea.content{min-height:120px;line-height:1.7;}
textarea.content.sm{min-height:70px;}
.save{background:#283593;border:none;color:#fff;font-weight:600;cursor:pointer;padding:8px 18px;}
.ghost{background:#16263f;color:#8ba2c8;cursor:pointer;padding:8px 18px;}
.crisis-opt{font-size:11px;color:#8ba2c8;display:flex;align-items:center;gap:8px;}
.submit-result{font-size:12px;color:#a5d6a7;background:#12261a;border:1px solid rgba(102,187,106,.35);border-radius:9px;padding:10px 13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.track-bar{display:flex;gap:8px;flex-wrap:wrap;}
.track-bar input{flex:1;min-width:180px;}
.track-err{font-size:12px;color:#ef9a9a;background:#4a1518;border:1px solid rgba(239,83,80,.3);border-radius:8px;padding:9px 12px;}
.track-result{background:#0c1730;border:1px solid rgba(120,160,220,0.14);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px;}
.tr-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.tr-head b{color:#fff;font-size:14px;}
.tr-sub{font-size:10px;color:#5b6f94;}
.track-result h5{margin:6px 0 0;color:#9fa8da;font-size:12px;}
.tl{display:flex;flex-direction:column;gap:0;border-left:2px solid rgba(120,160,220,.2);margin-left:6px;padding-left:14px;}
.tl-item{position:relative;padding:5px 0;}
.tl-dot{position:absolute;left:-19px;top:10px;width:9px;height:9px;border-radius:50%;background:#5c6bc0;border:2px solid #0c1730;}
.tl-item.external .tl-dot{background:#ffb300;}
.tl-body{display:flex;flex-direction:column;font-size:11px;}
.tl-body b{color:#dbe4f3;font-size:11px;display:flex;align-items:center;gap:7px;}
.side-tag{font-size:9px;font-style:normal;padding:0 6px;border-radius:4px;background:#16263f;color:#90caf9;}
.tl-item.external .side-tag{background:#33270e;color:#ffcc80;}
.tl-body span{color:#aebadd;font-size:10px;line-height:1.6;}
.tl-body em{color:#5b6f94;font-size:9px;font-style:normal;}
.supplement{margin-top:8px;background:#0f1b38;border:1px dashed rgba(255,179,0,.35);border-radius:9px;padding:11px;display:flex;flex-direction:column;gap:8px;}
.supplement h5{margin:0;color:#ffe082;font-size:12px;}
.kw{max-width:240px;}
.add{background:linear-gradient(135deg,#3949ab,#283593);border:none;color:#fff;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;}
.ct-table{width:100%;border-collapse:collapse;font-size:11px;background:#0f1b38;border-radius:10px;overflow:hidden;}
.ct-table th{background:#101b38;color:#8ba2c8;font-weight:600;padding:9px 10px;text-align:left;font-size:10px;}
.ct-table td{padding:9px 10px;border-top:1px solid rgba(120,160,220,0.1);color:#dbe4f3;}
.ct-table small{color:#5b6f94;}
.en{font-size:10px;padding:2px 8px;border-radius:5px;background:#1b5e20;color:#a5d6a7;}
.en.off{background:#3e2723;color:#ef9a9a;}
.ct-ops{display:flex;gap:5px;flex-wrap:wrap;}
.modal-mask{position:fixed;inset:0;background:rgba(5,10,20,.65);z-index:60;display:grid;place-items:center;padding:20px;}
.modal{background:#0f1b38;border:1px solid rgba(120,160,220,0.25);border-radius:14px;padding:18px 20px;width:min(620px,100%);max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;gap:11px;}
.modal h4{margin:0;color:#fff;font-size:15px;}
.m-sub{margin:0;font-size:11px;color:#8ba2c8;}
.m-field{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#aebadd;}
.m-field textarea{min-height:64px;}
.m-opt{display:flex;flex-direction:column;gap:8px;background:#0c1730;border:1px solid rgba(120,160,220,.15);border-radius:9px;padding:10px 12px;font-size:12px;}
.m-opt.disabled{opacity:.6;}
.m-opt label{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.wo-fields{display:flex;flex-direction:column;gap:7px;width:100%;padding-left:22px;}
.m-actions{display:flex;gap:10px;justify-content:flex-end;}
</style>
