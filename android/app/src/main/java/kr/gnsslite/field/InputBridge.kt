package kr.gnsslite.field

import android.view.KeyEvent
import android.view.MotionEvent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.hypot

/**
 * 블루투스 클리커(반지형 리모컨, HID) 입력 브리지.
 * 안드로이드는 HID 입력을 "입력 장치 이름"과 함께 주므로, 폰 화면 터치·폰 버튼과 클리커를 구분할 수 있다.
 *  - 입력 확인(monitor) 중이면 모든 장치의 키·터치·스크롤을 웹앱 `glNative.onInput(json)` 으로 알린다(설정 화면에서 어떤 입력인지 보기 위함).
 *  - 웹앱이 "클리커로 사용"으로 지정한 장치(remote)의 입력은 알린 뒤 소비한다(가짜 탭이 화면을 누르거나 볼륨이 바뀌지 않게).
 * 이벤트는 손을 뗄 때(UP) 한 번만 보낸다: 키는 누른 시간(ms), 터치는 탭/스와이프 방향과 위치(%).
 */
class InputBridge(private val web: WebView) {
    @Volatile private var monitor = false
    @Volatile private var remote: Set<String> = emptySet()

    private class Down(val x: Float, val y: Float, val t: Long)
    private val touchDown = HashMap<Int, Down>()
    private val keyDown = HashMap<String, Long>()

    @JavascriptInterface fun inputMonitor(on: Boolean) { monitor = on }

    /** 클리커로 쓸 장치 이름 목록(JSON 문자열 배열). 이 장치의 입력은 소비된다. */
    @JavascriptInterface fun setRemoteDevices(json: String) {
        remote = try {
            val a = JSONArray(json)
            (0 until a.length()).map { a.getString(it) }.toSet()
        } catch (_: Exception) { emptySet() }
    }

    private fun emit(o: JSONObject) {
        val js = "window.glNative&&glNative.onInput&&glNative.onInput(" + JSONObject.quote(o.toString()) + ")"
        web.post { web.evaluateJavascript(js, null) }
    }

    /** @return true 면 소비(앱·시스템에 더 전달하지 않음) */
    fun onKey(e: KeyEvent): Boolean {
        val dev = e.device ?: return false
        val name = dev.name ?: ""
        val isRemote = name in remote
        if (!monitor && !isRemote) return false
        if (e.repeatCount > 0) return isRemote
        val id = "${e.deviceId}:${e.keyCode}"
        if (e.action == KeyEvent.ACTION_DOWN) { keyDown[id] = e.eventTime; return isRemote }
        if (e.action == KeyEvent.ACTION_UP) {
            val ms = keyDown.remove(id)?.let { e.eventTime - it } ?: 0L
            emit(JSONObject().put("k", "key").put("dev", name).put("src", e.source).put("code", e.keyCode)
                .put("name", KeyEvent.keyCodeToString(e.keyCode)).put("ms", ms).put("remote", isRemote))
        }
        return isRemote
    }

    /** 터치: 손을 뗄 때 탭/스와이프로 판정해 한 번 알린다. */
    fun onTouch(ev: MotionEvent): Boolean {
        val dev = ev.device ?: return false
        val name = dev.name ?: ""
        val isRemote = name in remote
        if (!monitor && !isRemote) return false
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> touchDown[ev.deviceId] = Down(ev.x, ev.y, ev.eventTime)
            MotionEvent.ACTION_CANCEL -> touchDown.remove(ev.deviceId)
            MotionEvent.ACTION_UP -> {
                val d = touchDown.remove(ev.deviceId) ?: Down(ev.x, ev.y, ev.eventTime)
                val dx = ev.x - d.x
                val dy = ev.y - d.y
                val g = if (hypot(dx, dy) < 40f) "tap"
                        else if (abs(dx) > abs(dy)) (if (dx > 0) "swipe-right" else "swipe-left")
                        else (if (dy > 0) "swipe-down" else "swipe-up")
                val w = web.width.coerceAtLeast(1).toFloat()
                val h = web.height.coerceAtLeast(1).toFloat()
                emit(JSONObject().put("k", "touch").put("dev", name).put("src", ev.source).put("g", g)
                    .put("px", (100f * d.x / w).toInt()).put("py", (100f * d.y / h).toInt())
                    .put("dx", dx.toInt()).put("dy", dy.toInt()).put("ms", ev.eventTime - d.t).put("remote", isRemote))
            }
        }
        return isRemote
    }

    /** 마우스 휠형 리모컨: 스크롤(위/아래)을 한 번 알린다. */
    fun onScroll(ev: MotionEvent): Boolean {
        if (ev.actionMasked != MotionEvent.ACTION_SCROLL) return false
        val dev = ev.device ?: return false
        val name = dev.name ?: ""
        val isRemote = name in remote
        if (!monitor && !isRemote) return false
        val v = ev.getAxisValue(MotionEvent.AXIS_VSCROLL)
        emit(JSONObject().put("k", "scroll").put("dev", name).put("src", ev.source).put("v", v.toDouble()).put("remote", isRemote))
        return isRemote
    }
}
