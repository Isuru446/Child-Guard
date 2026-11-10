package com.example.final_project

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var pendingImageResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, PHONE_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "openOsmAttribution" -> {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.openstreetmap.org/copyright")))
                            result.success(true)
                        } catch (_: ActivityNotFoundException) {
                            result.success(false)
                        } catch (_: SecurityException) {
                            result.success(false)
                        }
                    }
                    "openMap" -> {
                        val uri = (call.arguments as? String)?.let { Uri.parse(it) }?.takeIf { it.isHierarchical }
                        val coordinates = uri?.getQueryParameter("query")?.split(',')
                        val latitude = coordinates?.getOrNull(0)?.toDoubleOrNull()
                        val longitude = coordinates?.getOrNull(1)?.toDoubleOrNull()
                        if (uri?.scheme != "https" || uri.host != "www.google.com" ||
                            uri.path != "/maps/search/" || uri.getQueryParameter("api") != "1" ||
                            uri.queryParameterNames != setOf("api", "query") || coordinates?.size != 2 ||
                            latitude == null || longitude == null || !latitude.isFinite() || !longitude.isFinite() ||
                            latitude !in -90.0..90.0 || longitude !in -180.0..180.0) {
                            result.success(false)
                        } else {
                            var opened = false
                            // App first, then a universal HTTPS handler (normally the browser).
                            for (target in listOf("com.google.android.apps.maps", null)) {
                                try {
                                    val intent = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
                                    if (target != null) intent.setPackage(target)
                                    startActivity(intent)
                                    opened = true
                                    break
                                } catch (_: ActivityNotFoundException) {
                                } catch (_: SecurityException) {
                                }
                            }
                            result.success(opened)
                        }
                    }
                    "dial" -> {
                        val phoneNumber = call.arguments as? String
                        if (phoneNumber.isNullOrBlank()) {
                            result.error(
                                "INVALID_PHONE",
                                "A phone number is required.",
                                null,
                            )
                            return@setMethodCallHandler
                        }

                        try {
                            startActivity(
                                Intent(
                                    Intent.ACTION_DIAL,
                                    Uri.parse("tel:$phoneNumber"),
                                ),
                            )
                            result.success(true)
                        } catch (error: ActivityNotFoundException) {
                            result.success(false)
                        } catch (error: SecurityException) {
                            result.success(false)
                        }
                    }
                    "pickImage" -> pickImage(result)
                    "sms" -> {
                        val args = call.arguments as? Map<*, *>
                        val phone = args?.get("phone") as? String
                        val message = args?.get("message") as? String
                        if (phone.isNullOrBlank() || message.isNullOrBlank()) {
                            result.success(false)
                        } else try {
                            startActivity(Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", phone, null)).apply {
                                putExtra("sms_body", message)
                            })
                            result.success(true)
                        } catch (error: ActivityNotFoundException) { result.success(false) }
                          catch (error: SecurityException) { result.success(false) }
                    }
                    "share" -> {
                        val message = call.arguments as? String
                        if (message.isNullOrBlank()) result.success(false)
                        else try {
                            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, message)
                            }, "Share pickup authorization"))
                            result.success(true)
                        } catch (error: ActivityNotFoundException) { result.success(false) }
                          catch (error: SecurityException) { result.success(false) }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun pickImage(result: MethodChannel.Result) {
        if (pendingImageResult != null) {
            result.error("PICKER_BUSY", "An image picker is already open.", null)
            return
        }

        pendingImageResult = result
        try {
            startActivityForResult(
                Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "image/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                },
                IMAGE_PICK_REQUEST,
            )
        } catch (error: ActivityNotFoundException) {
            pendingImageResult = null
            result.error("PICKER_UNAVAILABLE", "No image picker is available.", null)
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != IMAGE_PICK_REQUEST) return

        val result = pendingImageResult ?: return
        pendingImageResult = null
        val imageUri = data?.data
        if (resultCode != Activity.RESULT_OK || imageUri == null) {
            result.success(null)
            return
        }

        try {
            val imageBytes = contentResolver.openInputStream(imageUri)?.use {
                it.readBytes()
            }
            if (imageBytes == null) {
                result.error("IMAGE_READ_FAILED", "The selected image could not be read.", null)
            } else {
                result.success(imageBytes)
            }
        } catch (error: java.io.IOException) {
            result.error(
                "IMAGE_READ_FAILED",
                error.message ?: "The selected image could not be read.",
                null,
            )
        }
    }

    private companion object {
        const val PHONE_CHANNEL = "child_guard/phone"
        const val IMAGE_PICK_REQUEST = 4102
    }
}
