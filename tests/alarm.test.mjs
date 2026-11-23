// Модель системы будильников: проверяем, что на каждой границе занятия (каждые 30 минут) сработает служба (вибрация) — и когда страница открывается
// на каждой границе, и когда не открывается совсем, и когда система отказывает в будильнике на занятую секунду.
import assert from 'node:assert'
import * as core from '../shared/core.js'

const T = 1700000000000   // начало, мс (кратно секунде)
const H = 3600            // секунд в часе
const HALF = 1800         // секунд в получасе (длина занятия)
let n = 0
function t(name, f) { f(); n++; console.log('ok  ' + name) }

/** Поставить занятие и гонять модель secs секунд (шаг — секунда). opts: pageOpens, reject (отказ на занятую секунду для той же службы), stopAt (сек), queue (автостарт). */
function run(opts) {
  const o = Object.assign({ pageOpens: true, reject: false, secs: 6 * H + 600, stopAt: -1, queue: null }, opts)
  const st = core.newState()
  let nextId = 100
  let pending = []
  let stored = []
  const vib = []
  const api = {
    set(url, param, delay) {
      const at = nowMs + delay * 1000
      if (o.reject && pending.some((a) => a.url === url && Math.floor(a.at / 1000) === Math.floor(at / 1000))) return 0
      const id = nextId++
      pending.push({ id: id, url: url, param: param, at: at })
      return id
    },
    cancel(id) { pending = pending.filter((a) => a.id !== id) }
  }
  let nowMs = T
  function settle() {
    core.process(st, nowMs)
    const r = core.applyAlarms(st, nowMs, stored, api)
    stored = r.next
  }
  if (o.queue) { st.queue = o.queue.slice(); core.startAuto(st, T) } else core.toggle(st, 0, T)
  settle()
  for (nowMs = T; nowMs <= T + o.secs * 1000; nowMs += 1000) {
    if (o.stopAt >= 0 && nowMs === T + o.stopAt * 1000) { core.toggle(st, 0, nowMs); settle() }
    const due = pending.filter((a) => a.at <= nowMs).sort((a, b) => a.at - b.at)
    for (const a of due) {
      pending = pending.filter((x) => x !== a)
      if (a.url === 'app-service/alarm') vib.push({ t: nowMs, b: +a.param.split('|')[1] })
      else if (o.pageOpens) settle()
    }
  }
  return { vib: vib, st: st, pending: pending }
}

/** На каждой границе j (с first по last) есть вибрация службы не позже чем через 3,5 секунды. */
function covered(r, first, last) {
  const miss = []
  for (let j = first; j <= last; j++) {
    const b = T + j * HALF * 1000
    const ok = r.vib.some((v) => v.t - b >= 0 && v.t - b <= 3500)
    if (!ok) miss.push(j)
  }
  return miss
}

t('страница открывается на каждой границе: вибрация службы на каждой из 12 границ за шесть часов, ровно по одной', () => {
  const r = run({})
  assert.deepEqual(covered(r, 1, 12), [])
  assert.equal(r.vib.length, 12)
})

t('система отказывает в будильнике на занятую секунду: всё равно вибрирует на каждой границе', () => {
  const r = run({ reject: true })
  assert.deepEqual(covered(r, 1, 12), [])
})

t('страница не открывается совсем: службы хватает на всё окно вперёд (ALARM_AHEAD границ), дальше — тишина', () => {
  const r = run({ pageOpens: false, secs: 8 * H })
  assert.deepEqual(covered(r, 1, core.ALARM_AHEAD), [])
  assert.equal(r.vib.length, core.ALARM_AHEAD)
})

t('параметр будильника службы: вид|граница|сколько ещё впереди — без лишних полей', () => {
  const st = core.newState()
  core.toggle(st, 0, T)
  const p = core.alarmPlan(st, core.ALARM_AHEAD).filter((x) => x.url === 'app-service/alarm')
  assert.equal(p.length, core.ALARM_AHEAD)
  assert.equal(p.every((x) => x.param.split('|').length === 3), true)
  assert.equal(p[0].param.split('|')[0], 'hour')
  assert.equal(+p[0].param.split('|')[1], T / 1000 + HALF)
  assert.equal(core.TEST_PLAN, undefined)       // расписания вибрации теста нет
  assert.equal(core.methodFor, undefined)
  assert.equal(core.ALARM_AHEAD_TEST, undefined)
})

t('остановка занятия снимает все будильники: после неё вибрации нет', () => {
  const r = run({ stopAt: HALF + 300, secs: 3 * H })
  assert.equal(r.vib.length, 1)               // граница на 30-й минуте (следующая — на 60-й)
  assert.equal(r.pending.length, 0)
  assert.equal(r.vib.every((v) => v.t < T + (HALF + 300) * 1000), true)
})

t('автостарт: служба на каждую границу очереди и ни одной лишней', () => {
  const r = run({ queue: ['🧬', '💀', '🩸', '🤖'], secs: 3 * H })
  assert.deepEqual(covered(r, 1, 4), [])
  assert.equal(r.vib.length, 4)
  assert.equal(r.st.auto, false)
})

t('автостарт с 🏠 в очереди (🏠 — обычное занятие): служба на каждую границу, и когда страница открывается, и когда нет; очередь в конце пуста', () => {
  for (const pageOpens of [true, false]) {
    const r = run({ queue: ['🏠', '🧬', '🏠', '🏠'], secs: 2 * H + 1500, pageOpens: pageOpens })
    assert.deepEqual(covered(r, 1, 4), [])
    assert.equal(r.vib.length, 4)
    if (pageOpens) {
      assert.equal(r.st.auto, false)
      assert.deepEqual(r.st.queue, [])
      assert.equal(core.anyRunning(r.st), false)
    }
  }
})

t('план будильников: окно из ALARM_AHEAD границ вперёд, у каждого свой ключ, страница — только на ближайшую', () => {
  const st = core.newState()
  core.toggle(st, 0, T)
  const p = core.alarmPlan(st, 3)
  const s = p.filter((x) => x.url === 'app-service/alarm')
  const g = p.filter((x) => x.url === 'page/index')
  assert.equal(s.length, 3)
  assert.equal(g.length, 1)
  assert.deepEqual(s.map((x) => x.at), [T / 1000 + HALF + 1, T / 1000 + 2 * HALF + 1, T / 1000 + 3 * HALF + 1])
  assert.equal(g[0].at, T / 1000 + HALF + 4)
  assert.equal(new Set(p.map((x) => x.key)).size, p.length)
  // ничего не идёт — плана нет
  assert.equal(core.alarmPlan(core.newState(), 3).length, 0)
})

t('сравнение с уже стоящим: оставляем нужное, снимаем лишнее и старый формат (число вместо объекта)', () => {
  const st = core.newState()
  core.toggle(st, 0, T)
  const plan = core.alarmPlan(st, 3)
  const old = [{ k: plan[0].key, i: 5 }, { k: 'sxxx', i: 6 }, 77, { k: plan[0].key, i: 8 }]
  const d = core.alarmDiff(old, plan)
  assert.deepEqual(d.kept.map((x) => x.i), [5])
  assert.deepEqual(d.cancel, [6, 77, 8])
  assert.equal(d.add.length, plan.length - 1)
})

console.log('\nВсе проверки будильников пройдены: ' + n)
