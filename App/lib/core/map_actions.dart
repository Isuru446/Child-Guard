import 'package:flutter/services.dart';

bool validCoordinates(dynamic latitude, dynamic longitude) =>
    latitude is num &&
    longitude is num &&
    latitude.isFinite &&
    longitude.isFinite &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;

Uri googleMapsLocation(num latitude, num longitude) {
  if (!validCoordinates(latitude, longitude)) {
    throw ArgumentError('Invalid location');
  }
  return Uri.https('www.google.com', '/maps/search/', {
    'api': '1',
    'query': '${latitude.toDouble()},${longitude.toDouble()}',
  });
}

class MapActions {
  static const channel = MethodChannel('child_guard/phone');
  static Future<void> attribution() async {
    try {
      await channel.invokeMethod<bool>('openOsmAttribution');
    } on PlatformException {
      /* The attribution text remains visible. */
    } on MissingPluginException {
      /* Android launcher not available. */
    }
  }

  static Future<bool> open(num latitude, num longitude) async {
    if (!validCoordinates(latitude, longitude)) return false;
    try {
      return await channel.invokeMethod<bool>(
            'openMap',
            googleMapsLocation(latitude, longitude).toString(),
          ) ==
          true;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}
