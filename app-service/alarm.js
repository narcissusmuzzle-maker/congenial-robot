// Служба «будильник»: её запускает система в момент окончания занятия, даже если экран погашен и приложение закрыто.
// Она только вибрирует (первым делом и без проверок). Сама ничего не ставит: все будильники (на несколько ближайших границ вперёд)
// расставляет страница, см. core.alarmPlan. Журнала и тестовых способов вибрации с 1.24.0 нет.
// Параметр: вид|граница в секундах (UTC)|сколько границ ещё впереди (-1 — без ограничения); служба его не использует.
// Способ вибрации один: новый Vibrator, start({ mode: STRONG_REMINDER }) — серия из четырёх коротких (1200 мс); если не вышло — setMode + start().
import * as sensor from '@zos/sensor'

function buzz() {
  const mode = sensor.VIBRATOR_SCENE_STRONG_REMINDER
  let v = null
  try { v = new sensor.Vibrator() } catch (e) { return }
  try {
    v.start({ mode: mode })
  } catch (e) {
    try { v.setMode({ mode: mode }); v.start() } catch (e2) { /* вибромотор недоступен */ }
  }
}

AppService({
  onInit() { buzz() },
  onDestroy() {}
})
