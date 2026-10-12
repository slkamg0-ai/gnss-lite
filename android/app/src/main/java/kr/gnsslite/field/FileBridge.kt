package kr.gnsslite.field

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File

/**
 * 파일 내보내기 브리지(웹의 `GLFile`). WebView 는 웹 방식 다운로드(blob 링크)를 처리하지 못해서, 앱이 파일을 직접 저장하고 공유 창을 띄운다.
 *  saveFile(name, mime, base64): ① 캐시 exports/ 에 저장 ② 안드로이드 10+ 는 다운로드/간이측량기 폴더에도 저장 ③ 공유 창(카카오톡·메일·드라이브 등) 열기
 *  printPage(): 현재 화면을 시스템 인쇄(PDF 로 저장 가능)로 보낸다 — 웹앱의 인쇄용 스타일(성과표)이 그대로 쓰인다.
 */
class FileBridge(private val act: Activity, private val web: WebView) {

    private fun safe(name: String): String = name.replace(Regex("[^A-Za-z0-9._가-힣-]"), "_").take(80).ifBlank { "export.dat" }

    @JavascriptInterface
    fun saveFile(name: String, mime: String, b64: String): String {
        return try {
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            val fname = safe(name)
            val dir = File(act.cacheDir, "exports").apply { mkdirs() }
            val f = File(dir, fname)
            f.writeBytes(bytes)
            var where = "공유만"
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    val cv = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, fname)
                        put(MediaStore.MediaColumns.MIME_TYPE, mime)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/간이측량기")
                    }
                    val uri = act.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv)
                    if (uri != null) {
                        act.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                        where = "다운로드/간이측량기/$fname"
                    }
                } catch (_: Exception) { /* 저장 실패해도 공유는 가능 */ }
            }
            val uri = FileProvider.getUriForFile(act, act.packageName + ".files", f)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, fname)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            act.runOnUiThread {
                Toast.makeText(act, if (where == "공유만") "공유 창에서 보낼 곳을 고르세요" else "저장됨: $where", Toast.LENGTH_LONG).show()
                act.startActivity(Intent.createChooser(send, "내보내기: $fname"))
            }
            where
        } catch (e: Exception) {
            act.runOnUiThread { Toast.makeText(act, "내보내기 실패: " + (e.message ?: e.javaClass.simpleName), Toast.LENGTH_LONG).show() }
            "error: " + (e.message ?: "")
        }
    }

    @JavascriptInterface
    fun printPage() {
        act.runOnUiThread {
            try {
                val pm = act.getSystemService(Context.PRINT_SERVICE) as PrintManager
                val job = "측량 성과표"
                pm.print(job, web.createPrintDocumentAdapter(job), PrintAttributes.Builder().build())
            } catch (e: Exception) {
                Toast.makeText(act, "인쇄 실패: " + (e.message ?: ""), Toast.LENGTH_LONG).show()
            }
        }
    }
}
