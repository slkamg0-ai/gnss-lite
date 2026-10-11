package kr.gnsslite.field

import android.util.Base64
import java.net.InetSocketAddress
import java.net.Socket

/**
 * NTRIP 클라이언트 (NTRIP 2.0, 평문 TCP). 받은 RTCM 바이트는 [onRtcm] 으로 넘기고,
 * VRS 방식 캐스터가 요구하는 현재 위치 GGA 를 [gga] 가 주는 대로 주기적으로 올려 보낸다.
 * 끊어지면 5초 뒤 자동 재연결한다. [stop] 으로 완전히 멈춘다.
 */
class NtripClient(
    private val host: String,
    private val port: Int,
    private val mount: String,
    private val user: String,
    private val pass: String,
    private val gga: () -> String?,
    private val onRtcm: (ByteArray, Int) -> Unit,
    private val onState: (String) -> Unit,
) {
    @Volatile private var running = false
    @Volatile private var socket: Socket? = null
    private var thread: Thread? = null

    @Volatile var rtcmBytes = 0L
        private set

    fun start() {
        if (running) return
        running = true
        thread = Thread({ loop() }, "ntrip").also { it.isDaemon = true; it.start() }
    }

    fun stop() {
        running = false
        try { socket?.close() } catch (_: Exception) {}
        onState("stopped")
    }

    private fun loop() {
        while (running) {
            try {
                onState("connecting")
                session()
            } catch (e: Exception) {
                if (running) onState("error: " + (e.message ?: e.javaClass.simpleName))
            } finally {
                try { socket?.close() } catch (_: Exception) {}
            }
            if (running) {
                try { Thread.sleep(5000) } catch (_: InterruptedException) { return }
            }
        }
    }

    /** 일부 VRS 캐스터는 GPGGA 만 받는다: 토커 GN/GB/GA 를 GP 로 바꾸고 체크섬을 다시 계산한다. */
    private fun toGp(g: String): String {
        if (!g.startsWith("${'$'}") || g.length < 7 || g.substring(3, 6) != "GGA" || g.startsWith("${'$'}GP")) return g
        val star = g.indexOf('*')
        val body = "GP" + g.substring(3, if (star > 0) star else g.length)
        var c = 0
        for (ch in body) c = c xor ch.code
        return "${'$'}" + body + "*" + String.format("%02X", c)
    }

    private fun session() {
        val s = Socket()
        socket = s
        s.connect(InetSocketAddress(host, port), 10_000)
        s.soTimeout = 10_000   // 응답 헤더 대기
        val out = s.getOutputStream()
        val inp = s.getInputStream()
        val auth = Base64.encodeToString("$user:$pass".toByteArray(), Base64.NO_WRAP)
        val req = "GET /$mount HTTP/1.1\r\nHost: $host:$port\r\nNtrip-Version: Ntrip/2.0\r\n" +
            "User-Agent: NTRIP GnssLite/0.1\r\nAuthorization: Basic $auth\r\nConnection: close\r\n\r\n"
        out.write(req.toByteArray())
        out.flush()

        // 응답 헤더(빈 줄까지)를 읽는다. "ICY 200 OK" 또는 "HTTP/1.x 200"
        val head = StringBuilder()
        while (!head.endsWith("\r\n\r\n")) {
            val b = inp.read()
            if (b < 0) throw java.io.IOException("헤더 중 연결 종료")
            head.append(b.toChar())
            if (head.length > 4096) throw java.io.IOException("헤더가 너무 김")
        }
        val first = head.lineSequence().first()
        if (!first.contains(" 200")) throw java.io.IOException("거부됨: " + first.take(60))
        onState("connected")
        s.soTimeout = 1_000    // 이후엔 1초마다 깨어나 GGA 를 제때 올려 보낸다(읽기에 막혀 VRS 가 GGA 를 못 받는 문제 방지)

        val buf = ByteArray(4096)
        var lastGga = 0L
        var lastData = System.currentTimeMillis()
        while (running) {
            val now = System.currentTimeMillis()
            if (now - lastGga >= 10_000) {
                val g = gga()
                if (g != null) { out.write((toGp(g.trim()) + "\r\n").toByteArray()); out.flush(); lastGga = now }
                else lastGga = now - 9_000   // GGA 가 아직 없으면 1초 뒤 다시 시도
            }
            try {
                val n = inp.read(buf)
                if (n < 0) throw java.io.IOException("서버가 연결을 닫음")
                if (n > 0) { rtcmBytes += n; lastData = System.currentTimeMillis(); onRtcm(buf, n) }
            } catch (_: java.net.SocketTimeoutException) {
                if (System.currentTimeMillis() - lastData >= 25_000) throw java.io.IOException("RTCM 수신 없음(25초)")
            }
        }
    }
}
