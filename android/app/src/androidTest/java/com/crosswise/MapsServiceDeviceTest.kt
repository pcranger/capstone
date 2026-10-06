package com.crosswise

import android.location.Location
import com.crosswise.nav.NavigationService
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import androidx.test.platform.app.InstrumentationRegistry

/** Opt-in live integration test; public Sydney landmarks, never the phone's location. */
class MapsServiceDeviceTest {
    @Test fun searchDetailsAndWalkingRoute() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("liveMaps") == "true")
        assertTrue("Build-time Maps key missing", BuildConfig.MAPS_API_KEY.isNotBlank())
        val service = NavigationService()
        val places = service.search("Sydney Town Hall, Sydney NSW", null, BuildConfig.MAPS_API_KEY)
        assertTrue(places.isNotEmpty())
        val place = service.details(places.first().id, BuildConfig.MAPS_API_KEY)
        val origin = Location("public-test-landmark").apply { latitude = -33.8732; longitude = 151.2068 }
        val route = service.walking(origin, place, BuildConfig.MAPS_API_KEY)
        assertTrue(route.points.size > 1)
        assertTrue(route.steps.isNotEmpty())
        assertTrue(route.distanceMeters > 0)
    }
}
