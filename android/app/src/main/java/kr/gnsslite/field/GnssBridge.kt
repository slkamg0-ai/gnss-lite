package kr.gnsslite.field

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.ContextCompat
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import org.json.JSONObject

/**
 * 웹앱(WebView) ↔ 네이티브 연결부. 웹에서는 `window.GLNative.<메서드>()` 로 부르고,
 * 네이티브는 웹의 `window.glNative.onNmea(text)` / `onStatus(json)` 를 호출한다. (docs/ANDROID_BRIDGE.md)
 *
 *  보드(USB-UART) --NMEA--> 이 브리지 --> JS onNmea
 *  NTRIP 캐스터 --RTCM--> NtripClient --> 보드(USB 쓰기)
 *  최근 GGA --> NtripClient (VRS 위치 보고)
 */
class GnssBridge(private val ctx: Context, private val web: WebView) {
    private val usb = ctx.getSystemService(Context.USB_SERVICE) as UsbManager
    private val creds = CredStore(ctx)

    @Volatile private var port: UsbSerialPort? = null
    private var io: SerialInputOutputManager? = null
    private var ntrip: NtripClient? = null
    @Volatile private var lastGga: String? = null
    private val lineBuf = StringBuilder()
    private var nmeaCount = 0L
    private var usbState = "none"
    private var ntripState = "stopped"
    private var baud = 115200
    @Volatile private var wanted = false   // 웹앱이 내장 USB 소스를 쓰는 동안만 true

    private val actionPerm = "kr.gnsslite.field.USB_PERMISSION"
    private val permReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            if (i.action != actionPerm) return
            val dev: UsbDevice? = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                                  else @Suppress("DEPRECATION") i.getParcelableExtra(UsbManager.EXTRA_DEVICE)
            if (i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) && dev != null) openDevice(dev)
            else setUsb("denied")
        }
    }

    init {
        ContextCompat.registerReceiver(ctx, permReceiver, IntentFilter(actionPerm), ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    fun destroy() {
        stopAll()
        try { ctx.unregisterReceiver(permReceiver) } catch (_: Exception) {}
    }

    /** 보드가 꽂혀 있으면 자동으로 연결을 시도한다 (앱 시작·USB 꽂힘 때 호출). */
    fun autoConnect() { if (wanted && port == null) connectUsbInternal() }

    // ---------------- 웹에서 부르는 메서드 ----------------

    @JavascriptInterface fun listUsb(): String {
        val a = org.json.JSONArray()
        for (d in usb.deviceList.values) a.put(JSONObject().put("name", d.deviceName).put("vid", d.vendorId).put("pid", d.productId))
        return a.toString()
    }

    @JavascriptInterface fun connectUsb(baudRate: Int): Boolean { baud = if (baudRate > 0) baudRate else 115200; wanted = true; return connectUsbInternal() }
    @JavascriptInterface fun disconnectUsb() { wanted = false; closeUsb(); setUsb("none") }

    /** 계정을 암호화 저장한다. 저장 후 보정 수신을 시작하려면 [ntripStartSaved]. */
    @JavascriptInterface fun ntripSave(host: String, portNo: Int, mount: String, user: String, pass: String) {
        val keep = if (pass.isEmpty()) creds.load()?.pass ?: "" else pass   // 비밀번호를 비워 두면 이전에 저장한 값을 유지
        creds.save(CredStore.Ntrip(host.trim(), portNo, mount.trim().trimStart('/'), user, keep))
    }
    /** 저장된 계정 정보(비밀번호 제외). 없으면 "{}". */
    @JavascriptInterface fun ntripLoad(): String {
        val c = creds.load() ?: return "{}"
        return JSONObject().put("host", c.host).put("port", c.port).put("mount", c.mount).put("user", c.user).put("hasPass", c.pass.isNotEmpty()).toString()
    }
    @JavascriptInterface fun ntripClear() { stopNtrip(); creds.clear() }
    @JavascriptInterface fun ntripStartSaved(): Boolean {
        val c = creds.load() ?: return false
        stopNtrip()
        ntrip = NtripClient(c.host, c.port, c.mount, c.user, c.pass, { lastGga }, { b, n -> writeRtcm(b, n) }, { setNtrip(it) }).also { it.start() }
        return true
    }
    @JavascriptInterface fun ntripStop() { stopNtrip() }

    @JavascriptInterface fun status(): String = statusJson()

    // ---------------- 내부 ----------------

    private fun connectUsbInternal(): Boolean {
        val drivers = UsbSerialProber.getDefaultProber().findAllDrivers(usb)
        val driver = drivers.firstOrNull() ?: run { setUsb("no-device"); return false }
        if (!usb.hasPermission(driver.device)) {
            setUsb("asking-permission")
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            usb.requestPermission(driver.device, PendingIntent.getBroadcast(ctx, 0, Intent(actionPerm).setPackage(ctx.packageName), flags))
            return false
        }
        return openDevice(driver.device)
    }

    private fun openDevice(dev: UsbDevice): Boolean {
        closeUsb()
        val driver = UsbSerialProber.getDefaultProber().probeDevice(dev) ?: run { setUsb("unsupported"); return false }
        val conn = usb.openDevice(dev) ?: run { setUsb("open-failed"); return false }
        return try {
            val p = driver.ports[0]
            p.open(conn)
            p.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            port = p
            io = SerialInputOutputManager(p, object : SerialInputOutputManager.Listener {
                override fun onNewData(data: ByteArray) = onSerial(data)
                override fun onRunError(e: Exception) { closeUsb(); setUsb("error: " + (e.message ?: "")) }
            }).also { it.start() }
            setUsb("connected")
            true
        } catch (e: Exception) { closeUsb(); setUsb("error: " + (e.message ?: e.javaClass.simpleName)); false }
    }

    private fun closeUsb() {
        io?.stop(); io = null
        try { port?.close() } catch (_: Exception) {}
        port = null
    }

    private fun onSerial(data: ByteArray) {
        val lines = ArrayList<String>()
        synchronized(lineBuf) {
            lineBuf.append(String(data, Charsets.ISO_8859_1))
            while (true) {
                val i = lineBuf.indexOf("\n")
                if (i < 0) break
                val line = lineBuf.substring(0, i).trim()
                lineBuf.delete(0, i + 1)
                if (line.startsWith("$")) lines.add(line)
            }
            if (lineBuf.length > 4096) lineBuf.setLength(0)   // 쓰레기 데이터 방지
        }
        if (lines.isEmpty()) return
        for (l in lines) if (l.length > 6 && l.substring(3, 6) == "GGA") lastGga = l
        nmeaCount += lines.size
        val js = "window.glNative&&glNative.onNmea&&glNative.onNmea(" + JSONObject.quote(lines.joinToString("\n")) + ")"
        web.post { web.evaluateJavascript(js, null) }
    }

    private fun writeRtcm(b: ByteArray, n: Int) {
        try { port?.write(b.copyOf(n), 500) } catch (_: Exception) { /* USB 오류는 onRunError 에서 처리 */ }
    }

    private fun stopNtrip() { ntrip?.stop(); ntrip = null }
    private fun stopAll() { stopNtrip(); closeUsb() }

    private fun setUsb(s: String) { usbState = s; pushStatus() }
    private fun setNtrip(s: String) { ntripState = s; pushStatus() }

    private fun statusJson(): String = JSONObject()
        .put("usb", usbState).put("ntrip", ntripState)
        .put("nmea", nmeaCount).put("rtcm", ntrip?.rtcmBytes ?: 0L).toString()

    private fun pushStatus() {
        val js = "window.glNative&&glNative.onStatus&&glNative.onStatus(" + JSONObject.quote(statusJson()) + ")"
        web.post { web.evaluateJavascript(js, null) }
    }
}
