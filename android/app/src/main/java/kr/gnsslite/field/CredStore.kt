package kr.gnsslite.field

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** NTRIP 계정을 Android Keystore 로 암호화해 저장한다. 비밀번호는 웹(JS)으로 되돌려 주지 않는다. */
class CredStore(ctx: Context) {
    data class Ntrip(val host: String, val port: Int, val mount: String, val user: String, val pass: String)

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        ctx,
        "ntrip_cred",
        MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun save(c: Ntrip) {
        prefs.edit().putString("host", c.host).putInt("port", c.port).putString("mount", c.mount)
            .putString("user", c.user).putString("pass", c.pass).apply()
    }

    fun load(): Ntrip? {
        val host = prefs.getString("host", null) ?: return null
        return Ntrip(
            host, prefs.getInt("port", 2101), prefs.getString("mount", "") ?: "",
            prefs.getString("user", "") ?: "", prefs.getString("pass", "") ?: "",
        )
    }

    fun clear() = prefs.edit().clear().apply()
}
