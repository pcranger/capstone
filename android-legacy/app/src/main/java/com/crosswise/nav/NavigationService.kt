package com.crosswise.nav

import android.location.Location
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

data class GeoPoint(val latitude: Double, val longitude: Double)

data class PlaceCandidate(val id: String, val name: String, val address: String, val point: GeoPoint)

data class RouteStep(val instruction: String, val distanceMeters: Int)

data class WalkingRoute(
    val destination: String,
    val points: List<GeoPoint>,
    val steps: List<RouteStep>,
    val distanceMeters: Int,
    val durationSeconds: Int,
)

/**
 * Finds a place and a walking route for it.
 *
 * Ported from `PathFinder` in the AN-S3 project (UOW research), which uses the Places and Routes SDKs. This version
 * calls the same two Google services over REST with an API key, so the app needs no Play Services Places dependency
 * and no Maps SDK — one key in the conf file is the whole setup.
 */
class NavigationService {

    suspend fun findRoute(query: String, from: Location, apiKey: String): Result<WalkingRoute> =
        withContext(Dispatchers.IO) {
            if (apiKey.isBlank()) return@withContext Result.failure(IllegalStateException("No Maps API key set"))
            runCatching {
                val place = search(query, from, apiKey).firstOrNull() ?: error("No matching place")
                route(from, place, apiKey)
            }.onFailure { Log.w(TAG, "findRoute failed", it) }
        }

    suspend fun search(query: String, from: Location?, apiKey: String): List<PlaceCandidate> = withContext(Dispatchers.IO) {
        val body = JSONObject().put("textQuery", query).put("maxResultCount", 3)
        if (from != null) body.put("locationBias", JSONObject().put("circle", JSONObject()
            .put("center", JSONObject().put("latitude", from.latitude).put("longitude", from.longitude)).put("radius", 5000)))
        val response = JSONObject(post("https://places.googleapis.com/v1/places:searchText", body.toString(), apiKey,
            "places.id,places.displayName,places.location,places.formattedAddress"))
        val values = response.optJSONArray("places") ?: JSONArray()
        (0 until values.length()).map { candidate(values.getJSONObject(it)) }
    }
    suspend fun details(id: String, apiKey: String): PlaceCandidate = withContext(Dispatchers.IO) {
        require(id.matches(Regex("[A-Za-z0-9_-]+")))
        candidate(JSONObject(post("https://places.googleapis.com/v1/places/$id", null, apiKey, "id,displayName,location,formattedAddress")))
    }
    private fun candidate(json: JSONObject): PlaceCandidate {
        val point = json.getJSONObject("location")
        return PlaceCandidate(json.getString("id"), json.optJSONObject("displayName")?.optString("text").orEmpty(),
            json.optString("formattedAddress"), GeoPoint(point.getDouble("latitude"), point.getDouble("longitude")))
    }
    suspend fun walking(from: Location, to: PlaceCandidate, key: String): WalkingRoute = withContext(Dispatchers.IO) { route(from, to, key) }


    private fun route(from: Location, to: PlaceCandidate, apiKey: String): WalkingRoute {
        val body = JSONObject()
            .put("origin", waypoint(from.latitude, from.longitude))
            .put("destination", waypoint(to.point.latitude, to.point.longitude))
            .put("travelMode", "WALK")
            .put("polylineEncoding", "ENCODED_POLYLINE")
            .put("computeAlternativeRoutes", false)
            .put("languageCode", "en-AU")
            .put("units", "METRIC")
        val response = post(
            url = "https://routes.googleapis.com/directions/v2:computeRoutes",
            body = body.toString(),
            apiKey = apiKey,
            fieldMask = "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration," +
                "routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters",
        )
        val route = JSONObject(response).optJSONArray("routes")?.optJSONObject(0)
            ?: error("No walking route to ${to.name}")
        val encoded = route.getJSONObject("polyline").getString("encodedPolyline")
        val steps = ArrayList<RouteStep>()
        route.optJSONArray("legs")?.let { legs ->
            for (i in 0 until legs.length()) {
                val stepArray: JSONArray = legs.getJSONObject(i).optJSONArray("steps") ?: continue
                for (j in 0 until stepArray.length()) {
                    val step = stepArray.getJSONObject(j)
                    val instruction = step.optJSONObject("navigationInstruction")?.optString("instructions").orEmpty()
                    if (instruction.isNotBlank()) {
                        steps += RouteStep(instruction, step.optInt("distanceMeters"))
                    }
                }
            }
        }
        return WalkingRoute(
            destination = to.name,
            points = decodePolyline(encoded),
            steps = steps,
            distanceMeters = route.optInt("distanceMeters"),
            durationSeconds = route.optString("duration").removeSuffix("s").toIntOrNull() ?: 0,
        )
    }

    private fun waypoint(latitude: Double, longitude: Double) = JSONObject().put(
        "location",
        JSONObject().put("latLng", JSONObject().put("latitude", latitude).put("longitude", longitude)),
    )

    private fun post(url: String, body: String?, apiKey: String, fieldMask: String): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = if (body == null) "GET" else "POST"
            doOutput = body != null
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("X-Goog-Api-Key", apiKey)
            setRequestProperty("X-Goog-FieldMask", fieldMask)
        }
        if (body != null) connection.outputStream.use { it.write(body.toByteArray()) }
        val code = connection.responseCode
        val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
            ?.bufferedReader()?.use { it.readText() }.orEmpty()
        connection.disconnect()
        if (code !in 200..299) error("Maps request failed ($code). Retry.")
        return text
    }

    companion object {
        private const val TAG = "NavigationService"

        /** Google's encoded polyline, the same format their Maps SDK decodes internally. */
        fun decodePolyline(encoded: String): List<GeoPoint> {
            val points = ArrayList<GeoPoint>()
            var index = 0
            var lat = 0
            var lng = 0
            while (index < encoded.length) {
                var shift = 0
                var result = 0
                var b: Int
                do {
                    b = encoded[index++].code - 63
                    result = result or ((b and 0x1f) shl shift)
                    shift += 5
                } while (b >= 0x20)
                lat += if (result and 1 != 0) (result shr 1).inv() else result shr 1
                shift = 0
                result = 0
                do {
                    b = encoded[index++].code - 63
                    result = result or ((b and 0x1f) shl shift)
                    shift += 5
                } while (b >= 0x20)
                lng += if (result and 1 != 0) (result shr 1).inv() else result shr 1
                points += GeoPoint(lat / 1e5, lng / 1e5)
            }
            return points
        }

        fun distanceMeters(a: GeoPoint, b: GeoPoint): Double {
            val results = FloatArray(1)
            Location.distanceBetween(a.latitude, a.longitude, b.latitude, b.longitude, results)
            return results[0].toDouble()
        }

        /** Initial bearing from a to b, degrees clockwise from north. */
        fun bearing(a: GeoPoint, b: GeoPoint): Double {
            val lat1 = Math.toRadians(a.latitude)
            val lat2 = Math.toRadians(b.latitude)
            val dLon = Math.toRadians(b.longitude - a.longitude)
            val y = sin(dLon) * cos(lat2)
            val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
            return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
        }

        /** How far along segment a→b the point p projects, 0..1. Their anti-backtracking test, unchanged. */
        fun projectionRatio(p: GeoPoint, a: GeoPoint, b: GeoPoint): Double {
            val ax = a.longitude
            val ay = a.latitude
            val bx = b.longitude
            val by = b.latitude
            val px = p.longitude
            val py = p.latitude
            val dx = bx - ax
            val dy = by - ay
            val lengthSquared = dx * dx + dy * dy
            if (lengthSquared == 0.0) return 0.0
            return (((px - ax) * dx + (py - ay) * dy) / lengthSquared).coerceIn(0.0, 1.0)
        }

        fun distanceToSegmentMeters(p: GeoPoint, a: GeoPoint, b: GeoPoint): Double {
            val t = projectionRatio(p, a, b)
            val projected = GeoPoint(
                a.latitude + (b.latitude - a.latitude) * t,
                a.longitude + (b.longitude - a.longitude) * t,
            )
            return distanceMeters(p, projected)
        }

        @Suppress("unused")
        private fun unusedSqrt(value: Double) = sqrt(value)
    }
}
