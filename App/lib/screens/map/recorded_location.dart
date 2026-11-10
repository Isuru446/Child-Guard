import '../../core/map_actions.dart';

/// Display eligibility only; the server remains authoritative for child safety.
Map<String, dynamic>? validRecordedPoint(
  Map<String, dynamic> data,
  String childId,
) {
  if (data['child']?['id'] != childId) return null;
  final point = data['gpsMonitoring']?['lastValidLocation'];
  if (point is! Map ||
      !validCoordinates(point['latitude'], point['longitude']) ||
      point['recordedChildId'] != childId ||
      data['device'] == null) {
    return null;
  }
  return Map<String, dynamic>.from(point);
}

bool recentRecordedPoint(
  Map<String, dynamic> data,
  Map<String, dynamic>? point,
  DateTime now,
) {
  if (point == null ||
      point['state'] != 'RECENT' ||
      data['gpsMonitoring']?['latestStatus'] != 'GPS_FIX' ||
      data['device']?['active'] != true ||
      !recentCommunication(data, now)) {
    return false;
  }
  final observed = DateTime.tryParse('${point['observedAt']}');
  final seen = DateTime.tryParse('${data['device']?['lastSeen']}');
  if (observed == null || seen == null) return false;
  final age = now.toUtc().difference(observed.toUtc()).inMilliseconds;
  final seenAge = now.toUtc().difference(seen.toUtc()).inMilliseconds;
  return age >= 0 && age <= 60000 && seenAge >= 0 && seenAge <= 60000;
}

bool recentCommunication(Map<String, dynamic> data, DateTime now) {
  final seen = DateTime.tryParse('${data['device']?['lastSeen']}');
  if (seen == null ||
      data['device']?['active'] != true ||
      data['device']?['connectionState'] != 'ONLINE') {
    return false;
  }
  final age = now.toUtc().difference(seen.toUtc()).inMilliseconds;
  return age >= 0 && age <= 60000;
}

Map? validVisualZone(dynamic zone) =>
    zone is Map &&
        zone['active'] == true &&
        validCoordinates(zone['latitude'], zone['longitude']) &&
        zone['radiusM'] is num &&
        (zone['radiusM'] as num).isFinite &&
        zone['radiusM'] > 0
    ? zone
    : null;

String gpsStatusLabel(dynamic status) => switch (status) {
  'GPS_FIX' => 'GPS position recorded',
  'GPS_NO_FIX' => 'Waiting for a GPS fix',
  'GPS_NO_SERIAL' => 'GPS receiver is not reporting',
  _ => 'GPS information not available',
};
