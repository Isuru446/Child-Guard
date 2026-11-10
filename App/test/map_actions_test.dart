import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:final_project/core/map_actions.dart';
import 'package:final_project/screens/map/recorded_location.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final now = DateTime.utc(2026, 10, 28, 5);
  Map<String, dynamic> evidence() => {
    'child': {'id': 'allowed-child'},
    'device': {
      'active': true,
      'connectionState': 'ONLINE',
      'lastSeen': now.toIso8601String(),
    },
    'gpsMonitoring': {
      'latestStatus': 'GPS_FIX',
      'lastValidLocation': {
        'recordedChildId': 'allowed-child',
        'latitude': 6.8085485,
        'longitude': 79.99083517,
        'observedAt': now.toIso8601String(),
        'state': 'RECENT',
      },
    },
  };
  tearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(MapActions.channel, null),
  );
  test('encoded universal URL contains only the exact stored coordinates and API mode', () {
    final uri = googleMapsLocation(6.8085485, 79.99083517);
    expect(uri.scheme, 'https');
    expect(uri.host, 'www.google.com');
    expect(uri.path, '/maps/search/');
    expect(uri.queryParameters, {'api': '1', 'query': '6.8085485,79.99083517'});
    expect(uri.toString(), contains('%2C'));
    expect(validCoordinates(0, 0), isTrue);
    for (final pair in [
      [double.nan, 1],
      [1, double.infinity],
      [91, 0],
      [0, -181],
    ]) {
      expect(validCoordinates(pair[0], pair[1]), isFalse);
      expect(() => googleMapsLocation(pair[0], pair[1]), throwsArgumentError);
    }
  });
  test(
    'native launcher receives only a universal Maps URL and returns success',
    () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(MapActions.channel, (call) async {
            calls.add(call);
            return true;
          });
      expect(await MapActions.open(6.8, 79.9), isTrue);
      expect(calls.single.method, 'openMap');
      expect(calls.single.arguments, googleMapsLocation(6.8, 79.9).toString());
    },
  );
  test(
    'native failure, unavailable channel and invalid coordinates fail safely',
    () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(MapActions.channel, (_) async => false);
      expect(await MapActions.open(6.8, 79.9), isFalse);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            MapActions.channel,
            (_) async => throw PlatformException(code: 'unavailable'),
          );
      expect(await MapActions.open(6.8, 79.9), isFalse);
      expect(await MapActions.open(91, 0), isFalse);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(MapActions.channel, null);
      expect(await MapActions.open(6.8, 79.9), isFalse);
    },
  );
  test('recorded coordinates require the authorized child and assigned wearable; zero is legitimate', () {
    var data = evidence();
    expect(validRecordedPoint(data, 'allowed-child'), isNotNull);
    expect(validRecordedPoint(data, 'another-child'), isNull);
    data['gpsMonitoring']['lastValidLocation']['recordedChildId'] =
        'another-child';
    expect(validRecordedPoint(data, 'allowed-child'), isNull);
    data = evidence();
    data['device'] = null;
    expect(validRecordedPoint(data, 'allowed-child'), isNull);
    data = evidence();
    data['gpsMonitoring']['lastValidLocation']['latitude'] = double.infinity;
    expect(validRecordedPoint(data, 'allowed-child'), isNull);
    data = evidence();
    data['gpsMonitoring']['lastValidLocation'].addAll({
      'latitude': 0,
      'longitude': 0,
    });
    expect(validRecordedPoint(data, 'allowed-child'), isNotNull);
  });
  test('recent fix requires fresh communication, GPS_FIX, active device and proven recent time', () {
    for (final mode in [
      'recent',
      'old',
      'no-fix',
      'no-serial',
      'offline',
      'inactive',
      'future',
      'invalid-time',
      'stale-seen',
    ]) {
      final data = evidence();
      final point =
          data['gpsMonitoring']['lastValidLocation'] as Map<String, dynamic>;
      if (mode == 'old') point['observedAt'] = '2020-01-01T00:00:00Z';
      if (mode == 'no-fix') {
        data['gpsMonitoring']['latestStatus'] = 'GPS_NO_FIX';
      }
      if (mode == 'no-serial') {
        data['gpsMonitoring']['latestStatus'] = 'GPS_NO_SERIAL';
      }
      if (mode == 'offline') data['device']['connectionState'] = 'OFFLINE';
      if (mode == 'inactive') data['device']['active'] = false;
      if (mode == 'future') {
        point['observedAt'] = now
            .add(const Duration(minutes: 1))
            .toIso8601String();
      }
      if (mode == 'invalid-time') point['observedAt'] = 'bad-date';
      if (mode == 'stale-seen') {
        data['device']['lastSeen'] = '2020-01-01T00:00:00Z';
      }
      expect(
        recentRecordedPoint(data, point, now),
        mode == 'recent',
        reason: mode,
      );
      expect(
        validRecordedPoint(data, 'allowed-child'),
        isNotNull,
        reason: 'Historical coordinates remain usable for $mode',
      );
    }
  });
  test('safe-zone visualization rejects inactive, invalid, nonfinite and incomplete geometry', () {
    final zone = {
      'latitude': 6.8,
      'longitude': 79.9,
      'radiusM': 50,
      'active': true,
    };
    expect(validVisualZone(zone), zone);
    for (final bad in [
      null,
      {},
      {...zone, 'active': false},
      {...zone, 'latitude': 91},
      {...zone, 'radiusM': -1},
      {...zone, 'radiusM': double.infinity},
    ]) {
      expect(validVisualZone(bad), isNull);
    }
    expect(gpsStatusLabel('GPS_NO_FIX'), 'Waiting for a GPS fix');
    expect(gpsStatusLabel('GPS_NO_SERIAL'), 'GPS receiver is not reporting');
  });
}
