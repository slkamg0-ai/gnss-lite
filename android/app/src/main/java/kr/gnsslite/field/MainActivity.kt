package kr.gnsslite.field

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbManager
import android.os.Bundle
import android.view.WindowManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader

/** 기존 웹앱(assets/www)을 가상 https 출처에서 열고, 네이티브 USB/NTRIP 브리지를 붙인다. */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var bridge: GnssBridge

    private val origin = "https://appassets.androidplatform.net"
    private val startUrl = "$origin/app/www/index.html"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)   // 측량 중 화면 꺼짐 방지

        web = WebView(this)
        setContentView(web)

        // 텍스트 자원은 UTF-8 로 명시한다(스크립트 안의 한글이 깨지지 않게)
        val assets = WebViewAssetLoader.AssetsPathHandler(this)
        val utf8Assets = WebViewAssetLoader.PathHandler { path ->
            val r = assets.handle(path)
            val m = r?.mimeType ?: ""
            if (r != null && (m.startsWith("text/") || m.contains("javascript") || m.contains("json") || m.contains("manifest")))
                WebResourceResponse(m, "utf-8", r.data) else r
        }
        val loader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/app/", utf8Assets)
            .build()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
        }
        web.webChromeClient = object : WebChromeClient() {
            // 폰 GPS 소스(기존 기능)를 계속 쓰려면 위치 권한을 웹에 넘긴다
            override fun onGeolocationPermissionsShowPrompt(o: String, cb: GeolocationPermissions.Callback) {
                cb.invoke(o, o.startsWith(origin), false)
            }
            override fun onPermissionRequest(req: PermissionRequest) {
                // TODO: 마이크(음성)는 WebView 에 Web Speech 가 없어 네이티브 SpeechRecognizer 브리지로 대체 예정
                runOnUiThread { req.deny() }
            }
        }

        bridge = GnssBridge(this, web)
        web.addJavascriptInterface(bridge, "GLNative")

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), 1)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })

        web.loadUrl(startUrl)
    }

    override fun onResume() {
        super.onResume()
        bridge.autoConnect()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == UsbManager.ACTION_USB_DEVICE_ATTACHED) bridge.autoConnect()
    }

    override fun onDestroy() {
        bridge.destroy()
        web.destroy()
        super.onDestroy()
    }
}
